import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/prisma", () => ({ prisma: { user: { findFirst: vi.fn() }, tenant: { findUnique: vi.fn() } } }));
vi.mock("../config/env", () => ({ env: {} }));
vi.mock("../lib/jwt", () => ({ verifyAccessToken: vi.fn(), verifyEmployeePortalToken: vi.fn() }));
vi.mock("../modules/employeePortal/employeePortal.service", () => ({ tenantSuspendedMessage: vi.fn() }));
import { prisma } from "../lib/prisma";
import { requirePositionAction, requirePositionPosting } from "./positionMatrix";
import { requireRole, blockMutationsWhenReadOnly, assertCompanyAccess, canReadHrData, requireHrRead } from "./auth";
import { MATRIX_MARKER } from "../lib/positionMatrix";
import { saveMatrixSchema } from "../modules/positions/positions.schemas";

const request = (role = "accountant") => ({ auth: { sub: "user", tenantId: "tenant", role, companyScope: "company" }, method: "POST", body: {} }) as any;
function position(grant: object = {}, tenantId = "tenant") {
  return { position: { tenantId, permissions: [{ moduleId: MATRIX_MARKER }, { moduleId: "matrix:salesInvoices", ...grant }] } } as any;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ ownerId: "owner" } as any);
  vi.mocked(prisma.user.findFirst).mockResolvedValue(position());
});
describe("position matrix enforcement", () => {
  it("denies missing grants even for a legacy administrator", async () => {
    await expect(requirePositionAction("salesInvoices", "delete")(request("admin"), {} as any, vi.fn())).rejects.toMatchObject({ status: 403 });
  });
  it("grants independently of legacy role, without granting approval or deletion", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(position({ canCreate: true }));
    const req = request("viewer"), next = vi.fn();
    await requirePositionAction("salesInvoices", "create")(req, {} as any, next);
    requireRole("admin")(req, {} as any, next);
    expect(next).toHaveBeenCalledTimes(2);
    await expect(requirePositionAction("salesInvoices", "approve")(req, {} as any, vi.fn())).rejects.toMatchObject({ status: 403 });
    expect(() => requireRole("admin")(req, {} as any, vi.fn())).toThrow();
  });
  it("keeps company scope and subscription restrictions after a grant", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(position({ canCreate: true }));
    const req = request(); req.auth.readOnly = true;
    await requirePositionAction("salesInvoices", "create")(req, {} as any, vi.fn());
    expect(() => blockMutationsWhenReadOnly(req, {} as any, vi.fn())).toThrow();
    expect(() => assertCompanyAccess(req.auth, "other-company")).toThrow();
  });
  it("requires approval for default posting, but permits a draft", async () => {
    await expect(requirePositionPosting("salesInvoices", true)(request(), {} as any, vi.fn())).rejects.toMatchObject({ status: 403 });
    const req = request(); req.body.post = false; const next = vi.fn();
    await requirePositionPosting("salesInvoices", true)(req, {} as any, next);
    expect(next).toHaveBeenCalledOnce();
    req.body = { status: "posted" };
    await expect(requirePositionPosting("journalEntries")(req, {} as any, vi.fn())).rejects.toMatchObject({ status: 403 });
  });
  it("reloads assignment and rejects cross-tenant positions", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(position({ canRead: true })).mockResolvedValueOnce(position()).mockResolvedValueOnce(position({ canRead: true }, "other"));
    await requirePositionAction("salesInvoices", "read")(request(), {} as any, vi.fn());
    await expect(requirePositionAction("salesInvoices", "read")(request(), {} as any, vi.fn())).rejects.toMatchObject({ status: 403 });
    await expect(requirePositionAction("salesInvoices", "read")(request(), {} as any, vi.fn())).rejects.toMatchObject({ status: 403 });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user", tenantId: "tenant" } }));
  });
  it("preserves the owner and unchanged legacy positions", async () => {
    const req = request(); req.auth.sub = "owner"; const next = vi.fn();
    await requirePositionAction("salesInvoices", "approve")(req, {} as any, next);
    expect(next).toHaveBeenCalledOnce();
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ position: null } as any);
    const legacy = request("viewer");
    await requirePositionAction("salesInvoices", "create")(legacy, {} as any, next);
    expect(() => requireRole("admin")(legacy, {} as any, vi.fn())).toThrow();
  });
  it("does not expose HR data through an administrator's legacy role", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(position({ canRead: true }));
    const req = request("admin");
    await requirePositionAction("salesInvoices", "read")(req, {} as any, vi.fn());
    expect(canReadHrData(req.auth)).toBe(false);
    expect(() => requireHrRead(req, {} as any, vi.fn())).toThrow();
  });
  it("rejects duplicate, unknown and unsupported permissions", () => {
    const row = { resourceId: "dashboard", read: true, create: false, edit: false, delete: false, approve: false };
    expect(saveMatrixSchema.safeParse({ rows: [row] }).success).toBe(true);
    expect(saveMatrixSchema.safeParse({ rows: [row, row] }).success).toBe(false);
    expect(saveMatrixSchema.safeParse({ rows: [{ ...row, resourceId: "unknown" }] }).success).toBe(false);
    expect(saveMatrixSchema.safeParse({ rows: [{ ...row, delete: true }] }).success).toBe(false);
  });
});
