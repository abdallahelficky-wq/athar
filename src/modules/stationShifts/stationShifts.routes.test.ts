import "express-async-errors";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({ env: { jwtAccessSecret: "test-only-access-secret", jwtAccessExpiresIn: "15m" } }));
vi.mock("../../lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    positionActionPermission: { findUnique: vi.fn() },
    userActionPermissionOverride: { findUnique: vi.fn() },
    company: { findUnique: vi.fn() },
    costCenter: { findUnique: vi.fn() },
    stationNozzle: { findMany: vi.fn(), findFirst: vi.fn() },
    fuelPrice: { findMany: vi.fn() },
    stationShift: { findFirst: vi.fn(), update: vi.fn() },
    stationShiftReading: { upsert: vi.fn(), findMany: vi.fn() },
    stationShiftAuditLog: { create: vi.fn(), findMany: vi.fn() },
    attachment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/wellKnownAccounts", () => ({ getAccountIdByName: vi.fn(() => Promise.resolve("acc-generic")) }));
vi.mock("../../lib/journalPosting", () => ({ createJournalEntryTx: vi.fn(() => Promise.resolve({ id: "je-1" })) }));

import { stationShiftRoutes } from "./stationShifts.routes";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/station-shifts", stationShiftRoutes);
  app.use(((err, _req, res, _next) => { res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message }); }) as express.ErrorRequestHandler);
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/station-shifts`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));

const TENANT = "tenant-a";
const WORKER = "worker-1";
const ACCOUNTANT = "accountant-1";
const SHIFT_ID = "shift-1";

function token(sub: string) {
  return signAccessToken({ sub, tenantId: TENANT, role: "accountant", companyScope: "company-a", readOnly: false });
}
function call(method: string, path: string, sub: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(sub)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** لا مالك شركة، لا super_admin — كل الطلبات هنا تمرّ فعلياً عبر فحص PositionActionPermission
 * الحقيقي في requireActionPermission، لا مُتجاوَزة عبر تفويض تلقائي. */
function notTenantOwner() {
  vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ ownerId: "someone-else" } as never);
}

/** يمنح مستوى position واحداً على actionId واحد لمستخدم واحد، ويرفض أي actionId آخر (يُحاكي مستخدماً
 * له منصب حقيقي بصلاحية واحدة محدَّدة فقط، لا كل شيء). */
function grantPositionLevel(userId: string, actionId: string, level: string) {
  vi.mocked(prisma.userActionPermissionOverride.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockImplementation((({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id === userId ? { positionId: "position-1" } : null)) as unknown as typeof prisma.user.findUnique);
  vi.mocked(prisma.positionActionPermission.findUnique).mockImplementation(((
    { where }: { where: { positionId_moduleId_actionId: { actionId: string } } },
  ) =>
    Promise.resolve(where.positionId_moduleId_actionId.actionId === actionId ? { level } : null)) as unknown as typeof prisma.positionActionPermission.findUnique);
}

function noPositionAtAll() {
  vi.mocked(prisma.userActionPermissionOverride.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ positionId: null } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  notTenantOwner();
  vi.mocked(prisma.$transaction).mockImplementation(((cb: (tx: unknown) => unknown) => cb(prisma)) as typeof prisma.$transaction);
  vi.mocked(prisma.company.findUnique).mockResolvedValue({
    stationCashShortageAccountId: "acc-shortage",
    stationCashSurplusAccountId: "acc-surplus",
  } as never);
});

describe("a worker with 'worker'/edit level", () => {
  beforeEach(() => grantPositionLevel(WORKER, "worker", "edit"));

  it("can submit a reading", async () => {
    // getOwnedOpenShift ثم getPreviousClosingReadings
    vi.mocked(prisma.stationShift.findFirst)
      .mockResolvedValueOnce({ id: SHIFT_ID, tenantId: TENANT, companyId: "company-a", costCenterId: "station-1", employeeUserId: WORKER, status: "open" } as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.stationNozzle.findFirst).mockResolvedValue({ id: "nozzle-1", meterDigits: 6, product: "diesel" } as never);
    vi.mocked(prisma.stationShiftReading.upsert).mockResolvedValue({ id: "reading-1" } as never);

    const response = await call("POST", `/${SHIFT_ID}/readings`, WORKER, {
      nozzleId: "nozzle-1",
      closingReading: 500,
      testLiters: 0,
      workerConfirmedValue: 500,
      capturedAt: new Date().toISOString(),
    });

    expect(response.status).toBe(201);
  });

  it("is forbidden from approving a shift — 'worker' and 'review' are independent grants", async () => {
    const response = await call("POST", `/${SHIFT_ID}/approve`, WORKER);
    expect(response.status).toBe(403);
    expect(prisma.stationShift.findFirst).not.toHaveBeenCalled();
  });

  it("cannot reach a shift that belongs to a different worker's station: the auth gate passes but the ownership check still blocks it", async () => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValueOnce({
      id: SHIFT_ID,
      tenantId: TENANT,
      companyId: "company-a",
      costCenterId: "station-2",
      employeeUserId: "a-different-worker",
      status: "open",
    } as never);

    const response = await call("POST", `/${SHIFT_ID}/readings`, WORKER, {
      nozzleId: "nozzle-1",
      closingReading: 500,
      testLiters: 0,
      workerConfirmedValue: 500,
      capturedAt: new Date().toISOString(),
    });

    expect(response.status).toBe(403);
    expect(prisma.stationShiftReading.upsert).not.toHaveBeenCalled();
  });
});

describe("an accountant with 'review'/approve level", () => {
  beforeEach(() => grantPositionLevel(ACCOUNTANT, "review", "approve"));

  it("can approve a complete shift", async () => {
    const baseShift = { id: SHIFT_ID, tenantId: TENANT, companyId: "company-a", costCenterId: "station-1", status: "submitted" };
    vi.mocked(prisma.stationShift.findFirst)
      .mockResolvedValueOnce(baseShift as never) // assertShiftCompanyAccess (controller)
      .mockResolvedValueOnce(baseShift as never) // approveShift's own status check
      .mockResolvedValueOnce({ ...baseShift, readings: [], creditSales: [], expenses: [], collection: null } as never); // loadShiftClosingInput
    vi.mocked(prisma.stationNozzle.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.stationShiftReading.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.fuelPrice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.stationShift.update).mockResolvedValue({ id: SHIFT_ID, status: "approved" } as never);

    const response = await call("POST", `/${SHIFT_ID}/approve`, ACCOUNTANT);
    expect(response.status).toBe(200);
  });
});

describe("a user with no position at all (and no override, and not the tenant owner)", () => {
  beforeEach(() => noPositionAtAll());

  it("is denied on a worker endpoint (GET /my-station)", async () => {
    const response = await call("GET", "/my-station", WORKER);
    expect(response.status).toBe(403);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("is denied on an accountant endpoint (GET /pending)", async () => {
    const response = await call("GET", "/pending", ACCOUNTANT);
    expect(response.status).toBe(403);
    expect(prisma.stationShift.findFirst).not.toHaveBeenCalled();
  });
});
