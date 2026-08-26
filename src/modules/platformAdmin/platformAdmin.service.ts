import { prisma } from "../../lib/prisma";
import { notFound } from "../../lib/httpError";
import type { Prisma } from "@prisma/client";

const tenantSummarySelect = {
  id: true,
  name: true,
  subscriptionPlan: true,
  subscriptionStatus: true,
  trialEndsAt: true,
  suspensionReason: true,
  enabledModules: true,
  createdAt: true,
  _count: { select: { users: true, companies: true } },
} satisfies Prisma.TenantSelect;

/** كل الشركات (Tenants) المسجَّلة في أثر المحاسبي — بيانات إدارية على مستوى Tenant فقط (بلا أي
 * بيانات تشغيلية للشركات نفسها: لا فواتير، لا قيود، لا موظفين). */
export async function listTenantsForPlatform() {
  return prisma.tenant.findMany({ select: tenantSummarySelect, orderBy: { createdAt: "desc" } });
}

export async function getTenantForPlatform(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: tenantSummarySelect });
  if (!tenant) throw notFound("الشركة (Tenant) غير موجودة");
  return tenant;
}

export async function updateTenantSubscription(
  tenantId: string,
  input: { subscriptionStatus?: string; subscriptionPlan?: string; trialEndsAt?: Date | null; suspensionReason?: string | null },
) {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!existing) throw notFound("الشركة (Tenant) غير موجودة");

  return prisma.tenant.update({
    where: { id: tenantId },
    data: {
      subscriptionStatus: input.subscriptionStatus as never,
      subscriptionPlan: input.subscriptionPlan as never,
      trialEndsAt: input.trialEndsAt,
      suspensionReason: input.suspensionReason,
    },
    select: tenantSummarySelect,
  });
}

export async function updateTenantModules(tenantId: string, enabledModules: string[]) {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!existing) throw notFound("الشركة (Tenant) غير موجودة");
  return prisma.tenant.update({ where: { id: tenantId }, data: { enabledModules }, select: tenantSummarySelect });
}

export async function createTenantNotice(tenantId: string, message: string) {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!existing) throw notFound("الشركة (Tenant) غير موجودة");
  return prisma.platformNotice.create({ data: { tenantId, message } });
}

export async function listTenantNotices(tenantId: string) {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!existing) throw notFound("الشركة (Tenant) غير موجودة");
  return prisma.platformNotice.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
}

export async function deleteTenantNotice(tenantId: string, noticeId: string) {
  const existing = await prisma.platformNotice.findFirst({ where: { id: noticeId, tenantId } });
  if (!existing) throw notFound("الإشعار غير موجود");
  await prisma.platformNotice.delete({ where: { id: noticeId } });
}
