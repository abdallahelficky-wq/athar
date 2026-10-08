import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn(), findMany: vi.fn() } }));
vi.mock("../../lib/prisma", () => ({ prisma: db }));
import { listOwnAccounts } from "./accountDirectory";

describe("independent company account directory", () => {
  beforeEach(() => vi.resetAllMocks());
  it("derives identity from authenticated membership and selects only administrative fields", async () => {
    db.user.findFirst.mockResolvedValue({ identityId: "identity-a" });
    db.user.findMany.mockResolvedValue([
      { id: "u-a", tenantId: "t-a", tenant: { name: "Company A", code: 1001, subscriptionStatus: "active" } },
      { id: "u-b", tenantId: "t-b", tenant: { name: "Company B", code: 1002, subscriptionStatus: "suspended" } },
    ]);
    const result = await listOwnAccounts("u-a");
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: "u-a", active: true, deletedAt: null, inviteStatus: "accepted" },
      select: { identityId: true },
    });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { identityId: "identity-a", active: true, deletedAt: null, inviteStatus: "accepted" },
      select: { id: true, tenantId: true, tenant: { select: { name: true, code: true, subscriptionStatus: true } } },
      orderBy: { createdAt: "asc" },
    });
    expect(result).toEqual([
      { userId: "u-a", tenantId: "t-a", name: "Company A", code: 1001, current: true, suspended: false },
      { userId: "u-b", tenantId: "t-b", name: "Company B", code: 1002, current: false, suspended: true },
    ]);
  });
  it("rejects stale or inactive membership before looking up other accounts", async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(listOwnAccounts("removed")).rejects.toThrow();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
