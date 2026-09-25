import "express-async-errors";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({ env: { jwtAccessSecret: "test-only-access-secret", jwtAccessExpiresIn: "15m" } }));
vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    costCenter: { findFirst: vi.fn() },
    payrollComponent: { findMany: vi.fn() },
    employeePayrollComponent: { createMany: vi.fn() },
    employeeDocument: { deleteMany: vi.fn() },
    account: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/partyAccounts", () => ({ ensurePartyAccount: vi.fn(() => Promise.resolve({ accountId: "acc-emp" })) }));

// إسناد موظف لمحطة (Employee.assignedCostCenterId) — المسار الوحيد المدعوم لتفعيل ورديات المحطات
// لعامل؛ المحطة يجب أن تكون مركز تكلفة من نفس المستأجر ونفس شركة الموظف.
import { employeeRoutes } from "./employees.routes";
import { signAccessToken } from "../../lib/jwt";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/httpError";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/employees", employeeRoutes);
  app.use(((err, _req, res, _next) => { res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message }); }) as express.ErrorRequestHandler);
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/employees`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));

const TENANT = "tenant-a";
const COMPANY = "company-a";

function call(method: string, path: string, body?: unknown) {
  const token = signAccessToken({ sub: "hr-1", tenantId: TENANT, role: "hr_manager", companyScope: "all", readOnly: false });
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const existingEmployee = { id: "emp-1", tenantId: TENANT, companyId: COMPANY, name: "Worker", assignedCostCenterId: null, accountId: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((cb: (tx: unknown) => unknown) => cb(prisma)) as typeof prisma.$transaction);
  vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: COMPANY } as never);
  vi.mocked(prisma.employee.findFirst).mockResolvedValue(existingEmployee as never);
  vi.mocked(prisma.employee.update).mockImplementation((({ data }: { data: object }) => Promise.resolve({ ...existingEmployee, ...data })) as never);
  vi.mocked(prisma.payrollComponent.findMany).mockResolvedValue([] as never);
});

describe("assigning an employee to a station", () => {
  it("accepts a cost center of the employee's own tenant and company", async () => {
    vi.mocked(prisma.costCenter.findFirst).mockResolvedValue({ id: "station-1" } as never);

    const res = await call("PATCH", "/emp-1", { assignedCostCenterId: "station-1" });

    expect(res.status).toBe(200);
    expect(prisma.costCenter.findFirst).toHaveBeenCalledWith({ where: { id: "station-1", tenantId: TENANT, companyId: COMPANY } });
    expect(prisma.employee.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignedCostCenterId: "station-1" }) }));
  });

  it("rejects a cost center outside the employee's company or tenant, without updating", async () => {
    vi.mocked(prisma.costCenter.findFirst).mockResolvedValue(null as never);

    const res = await call("PATCH", "/emp-1", { assignedCostCenterId: "other-company-station" });

    expect(res.status).toBe(400);
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it("allows clearing the assignment without any cost center lookup", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ ...existingEmployee, assignedCostCenterId: "station-1" } as never);

    const res = await call("PATCH", "/emp-1", { assignedCostCenterId: null });

    expect(res.status).toBe(200);
    expect(prisma.costCenter.findFirst).not.toHaveBeenCalled();
    expect(prisma.employee.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignedCostCenterId: null }) }));
  });

  it("re-checks an existing station when the employee moves to another company", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ ...existingEmployee, assignedCostCenterId: "station-1" } as never);
    vi.mocked(prisma.costCenter.findFirst).mockResolvedValue(null as never);

    const res = await call("PATCH", "/emp-1", { companyId: "company-b" });

    expect(res.status).toBe(400);
    expect(prisma.costCenter.findFirst).toHaveBeenCalledWith({ where: { id: "station-1", tenantId: TENANT, companyId: "company-b" } });
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it("validates the station on create against the new employee's company", async () => {
    vi.mocked(prisma.costCenter.findFirst).mockResolvedValue(null as never);

    const res = await call("POST", "/", {
      companyId: COMPANY, name: "New worker", hireDate: "2026-09-01", basicSalary: 1500, assignedCostCenterId: "foreign-station",
    });

    expect(res.status).toBe(400);
    expect(prisma.costCenter.findFirst).toHaveBeenCalledWith({ where: { id: "foreign-station", tenantId: TENANT, companyId: COMPANY } });
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });

  it("ignores assignedCostCenterId in bulk import rows (no per-row station check exists there)", async () => {
    const { importEmployeesSchema } = await import("./employees.schemas");
    const parsed = importEmployeesSchema.parse({
      companyId: COMPANY,
      rows: [{ name: "Imported", hireDate: "2026-09-01", basicSalary: 1500, assignedCostCenterId: "station-1" }],
    });
    expect(parsed.rows[0]).not.toHaveProperty("assignedCostCenterId");
  });
});
