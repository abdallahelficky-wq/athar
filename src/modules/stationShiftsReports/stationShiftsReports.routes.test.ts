import "express-async-errors";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({ env: { jwtAccessSecret: "test-only-access-secret", jwtAccessExpiresIn: "15m" } }));
vi.mock("../../lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    positionActionPermission: { findUnique: vi.fn() },
    userActionPermissionOverride: { findUnique: vi.fn() },
    company: { findUnique: vi.fn() },
    costCenter: { findMany: vi.fn() },
    stationShiftReading: { findMany: vi.fn() },
    stationShiftCollection: { findMany: vi.fn() },
    stationShiftExpense: { findMany: vi.fn() },
    stationShift: { findMany: vi.fn() },
    fuelPrice: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
  },
}));
vi.mock("../../lib/wellKnownAccounts", () => ({ getAccountIdByName: vi.fn(() => Promise.resolve("acc-generic")) }));

import { stationShiftsReportRoutes } from "./stationShiftsReports.routes";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/station-shifts-reports", stationShiftsReportRoutes);
  app.use(((err, _req, res, _next) => { res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message }); }) as express.ErrorRequestHandler);
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/station-shifts-reports`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));

const TENANT = "tenant-a";
const COMPANY = "company-a";
const USER = "user-1";

function token(companyScope: string) {
  return signAccessToken({ sub: USER, tenantId: TENANT, role: "accountant", companyScope, readOnly: false });
}
function call(path: string, companyScope = COMPANY) {
  return fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token(companyScope)}` } });
}

function notTenantOwner() {
  vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ ownerId: "someone-else" } as never);
}
function noPositionAtAll() {
  vi.mocked(prisma.userActionPermissionOverride.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ positionId: null } as never);
}
function grantReviewPermission() {
  vi.mocked(prisma.userActionPermissionOverride.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ positionId: "position-1" } as never);
  vi.mocked(prisma.positionActionPermission.findUnique).mockImplementation(((
    { where }: { where: { positionId_moduleId_actionId: { actionId: string } } },
  ) =>
    Promise.resolve(where.positionId_moduleId_actionId.actionId === "review" ? { level: "approve" } : null)) as unknown as typeof prisma.positionActionPermission.findUnique);
}

beforeEach(() => {
  vi.resetAllMocks();
  notTenantOwner();
  vi.mocked(prisma.costCenter.findMany).mockResolvedValue([{ id: "station-1", name: "محطة 1" }] as never);
  vi.mocked(prisma.stationShiftReading.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.stationShiftCollection.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.stationShiftExpense.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.stationShift.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.fuelPrice.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.customer.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.company.findUnique).mockResolvedValue({ stationCashShortageAccountId: "acc-shortage", stationCashSurplusAccountId: "acc-surplus" } as never);
});

describe("non-sensitive station-shift reports need no stationShifts position permission at all", () => {
  beforeEach(() => noPositionAtAll());

  it.each([
    ["/sales-volume?groupBy=station"],
    ["/cash-summary"],
    ["/expenses"],
  ])("GET %s succeeds for a plain company-scoped user", async (path) => {
    const response = await call(path);
    expect(response.status).toBe(200);
  });
});

describe("net cash is gated behind the same reviewer permission as the accountant screen", () => {
  it("is denied for a user with no stationShifts position at all", async () => {
    noPositionAtAll();
    const response = await call("/net-cash");
    expect(response.status).toBe(403);
    expect(prisma.stationShift.findMany).not.toHaveBeenCalled();
  });

  it("is denied for a user whose position only has 'post' level, not 'review'", async () => {
    vi.mocked(prisma.userActionPermissionOverride.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ positionId: "position-1" } as never);
    vi.mocked(prisma.positionActionPermission.findUnique).mockImplementation(((
      { where }: { where: { positionId_moduleId_actionId: { actionId: string } } },
    ) =>
      Promise.resolve(where.positionId_moduleId_actionId.actionId === "post" ? { level: "approve" } : null)) as unknown as typeof prisma.positionActionPermission.findUnique);

    const response = await call("/net-cash");
    expect(response.status).toBe(403);
  });

  it("succeeds for a user whose position has the 'review'/approve level", async () => {
    grantReviewPermission();
    const response = await call("/net-cash");
    expect(response.status).toBe(200);
  });
});

describe("seed-data exceptions — the isSeedData audit list", () => {
  it("is gated behind the same reviewer permission as net-cash", async () => {
    noPositionAtAll();
    const response = await call("/seed-data-exceptions");
    expect(response.status).toBe(403);
    expect(prisma.stationShift.findMany).not.toHaveBeenCalled();
  });

  it("lists every isSeedData=true shift for a reviewer, regardless of status or date", async () => {
    grantReviewPermission();
    vi.mocked(prisma.stationShift.findMany).mockResolvedValue([
      { id: "seed-shift-1", shiftDate: new Date("2020-01-01"), status: "posted", costCenter: { id: "station-1", name: "Station 1" } },
    ] as never);

    const response = await call("/seed-data-exceptions");
    expect(response.status).toBe(200);
    expect(prisma.stationShift.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isSeedData: true }) }));
    const body = await response.json();
    expect(body.rows).toEqual([{ id: "seed-shift-1", costCenterId: "station-1", costCenterName: "Station 1", shiftDate: "2020-01-01T00:00:00.000Z", status: "posted" }]);
  });

  it("reports an empty list when there is no seed data at all — the expected state in production", async () => {
    grantReviewPermission();
    vi.mocked(prisma.stationShift.findMany).mockResolvedValue([] as never);

    const response = await call("/seed-data-exceptions");
    const body = await response.json();
    expect(body.rows).toEqual([]);
  });
});

describe("query filtering sent to the database", () => {
  beforeEach(() => noPositionAtAll());

  it("only ever queries approved/posted, non-seed shifts for sales-volume", async () => {
    await call("/sales-volume?groupBy=station");
    expect(prisma.stationShiftReading.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shift: expect.objectContaining({ status: { in: ["approved", "posted"] }, isSeedData: false }),
        }),
      }),
    );
  });

  it("only ever queries approved/posted, non-seed shifts for cash-summary", async () => {
    await call("/cash-summary");
    expect(prisma.stationShiftCollection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shift: expect.objectContaining({ status: { in: ["approved", "posted"] }, isSeedData: false }),
        }),
      }),
    );
  });

  it("only ever queries approved/posted, non-seed shifts for expenses", async () => {
    await call("/expenses");
    expect(prisma.stationShiftExpense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shift: expect.objectContaining({ status: { in: ["approved", "posted"] }, isSeedData: false }),
        }),
      }),
    );
  });

  it("only ever queries approved/posted, non-seed shifts for net-cash", async () => {
    grantReviewPermission();
    await call("/net-cash");
    expect(prisma.stationShift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["approved", "posted"] }, isSeedData: false }),
      }),
    );
  });
});

describe("date range validation", () => {
  beforeEach(() => noPositionAtAll());

  it("rejects a range longer than 366 days with a clear 400", async () => {
    const response = await call("/sales-volume?groupBy=station&dateFrom=2020-01-01&dateTo=2026-01-01");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/366/);
  });
});

describe("groupBy validation", () => {
  beforeEach(() => noPositionAtAll());

  it("rejects an unknown groupBy value", async () => {
    const response = await call("/sales-volume?groupBy=nonsense");
    expect(response.status).toBe(400);
  });

  it("rejects a missing groupBy value", async () => {
    const response = await call("/sales-volume");
    expect(response.status).toBe(400);
  });
});

describe("companyId resolution", () => {
  it("rejects a companyScope='all' user who didn't pass an explicit companyId", async () => {
    noPositionAtAll();
    const response = await call("/sales-volume?groupBy=station", "all");
    expect(response.status).toBe(400);
  });

  it("accepts a companyScope='all' user who passes an explicit companyId", async () => {
    noPositionAtAll();
    const response = await call("/sales-volume?groupBy=station&companyId=company-a", "all");
    expect(response.status).toBe(200);
  });
});
