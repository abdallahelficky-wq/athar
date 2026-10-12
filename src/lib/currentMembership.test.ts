import { beforeEach, expect, it, vi } from "vitest";
const findUnique = vi.hoisted(() => vi.fn());
vi.mock("./prisma", () => ({ prisma: { user: { findUnique } } }));
import { assertCurrentMembership } from "./currentMembership";
const token = { sub: "u", tenantId: "old", role: "admin", companyScope: "all", readOnly: false };
const active = { tenantId: "old", role: "admin", companyScope: "all", active: true, deletedAt: null, inviteStatus: "accepted" };
beforeEach(() => findUnique.mockReset());
it("accepts an unchanged active membership", async () => {
  findUnique.mockResolvedValue(active);
  await expect(assertCurrentMembership(token)).resolves.toBeUndefined();
});
it.each([
  { tenantId: "new" }, { companyScope: "company" }, { role: "viewer" },
  { active: false }, { deletedAt: new Date() }, { inviteStatus: "pending" },
])("rejects stale claims after access changes: %j", async change => {
  findUnique.mockResolvedValue({ ...active, ...change });
  await expect(assertCurrentMembership(token)).rejects.toThrow();
});
it("rejects a removed membership", async () => {
  findUnique.mockResolvedValue(null);
  await expect(assertCurrentMembership(token)).rejects.toThrow();
});
