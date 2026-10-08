import { prisma } from "./prisma";
import type { AccessTokenPayload } from "./jwt";
import { unauthorized } from "./httpError";

/** Reject signatures that were issued before a membership moved or lost access. */
export async function assertCurrentMembership(payload: AccessTokenPayload) {
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { tenantId: true, role: true, companyScope: true, active: true, deletedAt: true, inviteStatus: true },
  });
  if (!user || !user.active || user.deletedAt || user.inviteStatus !== "accepted"
    || user.tenantId !== payload.tenantId || user.role !== payload.role || user.companyScope !== payload.companyScope) {
    throw unauthorized("رمز الدخول غير صالح أو منتهي الصلاحية");
  }
}
