import { prisma } from "../../lib/prisma";
import { unauthorized } from "../../lib/httpError";

/** Only accepted memberships of the authenticated identity; no company business data. */
export async function listOwnAccounts(userId: string) {
  const current = await prisma.user.findFirst({
    where: { id: userId, active: true, deletedAt: null, inviteStatus: "accepted" },
    select: { identityId: true },
  });
  if (!current) throw unauthorized("الحساب غير موجود أو معطّل");
  const memberships = await prisma.user.findMany({
    where: { identityId: current.identityId, active: true, deletedAt: null, inviteStatus: "accepted" },
    select: {
      id: true, tenantId: true,
      tenant: { select: { name: true, code: true, subscriptionStatus: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map(m => ({
    userId: m.id, tenantId: m.tenantId, name: m.tenant.name,
    code: m.tenant.code, current: m.id === userId,
    suspended: m.tenant.subscriptionStatus === "suspended",
  }));
}
