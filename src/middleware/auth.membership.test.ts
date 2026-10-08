import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../config/env", () => ({ env: { jwtAccessSecret: "test-secret", jwtAccessExpiresIn: "15m", jwtEmployeePortalSecret: "portal-secret", jwtEmployeePortalExpiresIn: "1h" } }));
vi.mock("../lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn() }, employee: { findUnique: vi.fn() }, tenant: { findUnique: vi.fn() } } }));
vi.mock("../modules/employeePortal/employeePortal.service", () => ({ tenantSuspendedMessage: () => "suspended" }));
import { authenticate, authenticateEmployeePortal } from "./auth";
import { signAccessToken, signEmployeePortalToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
const claims = { sub: "u", tenantId: "old", companyScope: "all", role: "admin", readOnly: false };
const membership = { ...claims, active: true, deletedAt: null, inviteStatus: "accepted" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ subscriptionStatus: "active" } as any); });
it.each([{}, { tenantId: "new" }, { companyScope: "company" }, { active: false }])("validates live membership for a genuinely signed token: %j", async change => {
 vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...membership, ...change } as any);
 const next = vi.fn(); const req: any = { headers: { authorization: `Bearer ${signAccessToken(claims)}` } };
 if (Object.keys(change).length) { await expect(authenticate(req, {} as any, next)).rejects.toMatchObject({ status: 401 }); expect(next).not.toHaveBeenCalled(); }
 else { await authenticate(req, {} as any, next); expect(next).toHaveBeenCalledOnce(); }
});
it.each([{tenantId:"old",portalActive:true}, {tenantId:"new",portalActive:true}, {tenantId:"old",portalActive:false}, null])("invalidates employee portal access after a move or disabling: %j", async employee => {
 vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any);
 const next = vi.fn(); const req: any = { headers: { authorization: `Bearer ${signEmployeePortalToken({employeeId:"e",tenantId:"old"})}` } };
 if (employee?.tenantId === "old" && employee.portalActive) { await authenticateEmployeePortal(req, {} as any, next); expect(next).toHaveBeenCalledOnce(); }
 else { await expect(authenticateEmployeePortal(req, {} as any, next)).rejects.toMatchObject({status:401}); expect(next).not.toHaveBeenCalled(); }
});
