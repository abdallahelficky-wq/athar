import "express-async-errors";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  env: { jwtEmployeePortalSecret: "test-only-employee-portal-secret", jwtEmployeePortalExpiresIn: "7d" },
}));
vi.mock("../../lib/prisma", () => ({
  prisma: {
    employee: { findFirst: vi.fn() },
    costCenter: { findUnique: vi.fn() },
    stationNozzle: { findMany: vi.fn(), findFirst: vi.fn() },
    fuelPrice: { findMany: vi.fn() },
    stationShift: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    stationShiftReading: { upsert: vi.fn(), findMany: vi.fn() },
    stationShiftCollection: { findUnique: vi.fn() },
    stationShiftCreditSale: { findMany: vi.fn() },
    stationShiftExpense: { findMany: vi.fn() },
  },
}));

// بلا Position/PositionActionPermission هنا إطلاقاً — بوابة الموظف لا تملك هذا المفهوم أصلاً؛
// راجع stationShifts.routes.test.ts لشاشة المحاسب (User/Position).
import { stationShiftPortalRoutes } from "./stationShifts.portal.routes";
import { signEmployeePortalToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/employee-portal/station-shifts", stationShiftPortalRoutes);
  app.use(((err, _req, res, _next) => { res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message }); }) as express.ErrorRequestHandler);
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/employee-portal/station-shifts`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));

const TENANT = "tenant-a";
const WORKER = "employee-1";
const SHIFT_ID = "shift-1";

function token(employeeId: string) {
  return signEmployeePortalToken({ employeeId, tenantId: TENANT });
}
function call(method: string, path: string, employeeId: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(employeeId)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => vi.resetAllMocks());

describe("a worker (employee-portal token, no Position/PositionActionPermission involved at all)", () => {
  it("can submit a reading for their own open shift", async () => {
    // getOwnedOpenShift ثم getPreviousClosingReadings
    vi.mocked(prisma.stationShift.findFirst)
      .mockResolvedValueOnce({ id: SHIFT_ID, tenantId: TENANT, companyId: "company-a", costCenterId: "station-1", employeeId: WORKER, status: "open" } as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.stationNozzle.findFirst).mockResolvedValue({ id: "nozzle-1", meterDigits: 6, product: "diesel" } as never);
    vi.mocked(prisma.stationShiftReading.upsert).mockResolvedValue({ id: "reading-1" } as never);

    const response = await call("POST", `/${SHIFT_ID}/readings`, WORKER, {
      nozzleId: "nozzle-1",
      capturedAt: new Date().toISOString(),
    });

    expect(response.status).toBe(201);
  });

  it("cannot reach a shift that belongs to a different worker: the ownership check blocks it", async () => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValueOnce({
      id: SHIFT_ID,
      tenantId: TENANT,
      companyId: "company-a",
      costCenterId: "station-2",
      employeeId: "a-different-employee",
      status: "open",
    } as never);

    const response = await call("POST", `/${SHIFT_ID}/readings`, WORKER, {
      nozzleId: "nozzle-1",
      capturedAt: new Date().toISOString(),
    });

    expect(response.status).toBe(403);
    expect(prisma.stationShiftReading.upsert).not.toHaveBeenCalled();
  });

  it("GET /:id/summary never exposes cashDue, variance, or posting lines — only their own submitted data", async () => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue({
      id: SHIFT_ID,
      tenantId: TENANT,
      companyId: "company-a",
      costCenterId: "station-1",
      employeeId: WORKER,
      status: "submitted",
      shiftType: "morning",
      shiftDate: new Date("2026-07-01"),
    } as never);
    vi.mocked(prisma.stationShiftReading.findMany).mockResolvedValue([
      { id: "reading-1", nozzleId: "nozzle-1", openingReading: 100, closingReading: 500, testLiters: 0, workerConfirmedValue: 500, capturedAt: new Date(), nozzle: { pumpNumber: 1, nozzleNumber: 1, product: "diesel" } },
    ] as never);
    vi.mocked(prisma.stationShiftExpense.findMany).mockResolvedValue([{ id: "exp-1", amount: 50, category: "صيانة", description: null }] as never);
    vi.mocked(prisma.stationShiftCreditSale.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.stationShiftCollection.findUnique).mockResolvedValue({ networkAmount: 200, fuelCardAmount: 0, cashDelivered: 900 } as never);

    const response = await call("GET", `/${SHIFT_ID}/summary`, WORKER);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toHaveProperty("readings");
    expect(body).toHaveProperty("expenses");
    expect(body).toHaveProperty("collection");
    for (const leakedField of ["cashDue", "variance", "expectedCash", "lines", "grossSales", "salesByProduct"]) {
      expect(body).not.toHaveProperty(leakedField);
    }
  });

  it("GET /:id/summary rejects a worker fetching another worker's shift", async () => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue({
      id: SHIFT_ID,
      tenantId: TENANT,
      companyId: "company-a",
      costCenterId: "station-2",
      employeeId: "a-different-employee",
      status: "submitted",
    } as never);

    const response = await call("GET", `/${SHIFT_ID}/summary`, WORKER);
    expect(response.status).toBe(403);
    expect(prisma.stationShiftReading.findMany).not.toHaveBeenCalled();
  });

  it("is denied a clear error on GET /my-station when no station is assigned — the assignment itself is the only 'permission' this side has", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ assignedCostCenterId: null } as never);

    const response = await call("GET", "/my-station", WORKER);
    expect(response.status).toBe(400);
    expect(prisma.costCenter.findUnique).not.toHaveBeenCalled();
  });
});
