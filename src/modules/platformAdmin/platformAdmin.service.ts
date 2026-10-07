import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";
import type { Prisma } from "@prisma/client";

const tenantSummarySelect = {
  id: true,
  code: true,
  name: true,
  subscriptionPlan: true,
  subscriptionStatus: true,
  trialEndsAt: true,
  suspensionReason: true,
  enabledModules: true,
  createdAt: true,
  _count: { select: { users: true, companies: true } },
  // أول مستخدم سجَّل لهذه الشركة (المُنشَأ ضمن نفس معاملة التسجيل نفسها في auth.service.ts —
  // يحمل دائماً دور admin أو super_admin) — نجلب بريده الإلكتروني فقط لعرضه كـ adminEmail.
  users: { select: { identity: { select: { email: true } } }, orderBy: { createdAt: "asc" }, take: 1 },
} satisfies Prisma.TenantSelect;

type TenantSummaryRaw = Prisma.TenantGetPayload<{ select: typeof tenantSummarySelect }>;

/** يُحوِّل نتيجة Prisma الخام (تتضمن مصفوفة users بعنصر واحد كحد أقصى) إلى شكل الاستجابة العلني:
 * adminEmail مباشرة بدل مصفوفة users. */
function mapTenantSummary(tenant: TenantSummaryRaw) {
  const { users, ...rest } = tenant;
  return { ...rest, adminEmail: users[0]?.identity.email ?? null };
}

/** كل الشركات (Tenants) المسجَّلة في أثر المحاسبي — بيانات إدارية على مستوى Tenant فقط (بلا أي
 * بيانات تشغيلية للشركات نفسها: لا فواتير، لا قيود، لا موظفين). */
export async function listTenantsForPlatform() {
  const tenants = await prisma.tenant.findMany({ select: tenantSummarySelect, orderBy: { createdAt: "desc" } });
  return tenants.map(mapTenantSummary);
}

export async function getTenantForPlatform(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: tenantSummarySelect });
  if (!tenant) throw notFound("الشركة (Tenant) غير موجودة");
  return mapTenantSummary(tenant);
}

/** Administrative directory only: never return accounting, employee, credential or permission payloads. */
export async function getTenantDirectory(tenantId: string) {
  await getTenantForPlatform(tenantId);
  const [users, companies] = await Promise.all([
    prisma.user.findMany({ where: { tenantId, deletedAt: null }, select: {
      id: true, name: true, role: true, active: true, inviteStatus: true,
      companyScope: true, createdAt: true, lastLoginAt: true,
      identity: { select: { email: true } },
    }, orderBy: { createdAt: "asc" } }),
    prisma.company.findMany({ where: { tenantId }, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return { users: users.map(({ identity, ...user }) => ({ ...user, email: identity.email })), companies };
}

export async function updateTenantSubscription(
  tenantId: string,
  input: { subscriptionStatus?: string; subscriptionPlan?: string; trialEndsAt?: Date | null; suspensionReason?: string | null },
) {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!existing) throw notFound("الشركة (Tenant) غير موجودة");

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      subscriptionStatus: input.subscriptionStatus as never,
      subscriptionPlan: input.subscriptionPlan as never,
      trialEndsAt: input.trialEndsAt,
      suspensionReason: input.suspensionReason,
    },
    select: tenantSummarySelect,
  });
  return mapTenantSummary(updated);
}

export async function updateTenantModules(tenantId: string, enabledModules: string[]) {
  const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!existing) throw notFound("الشركة (Tenant) غير موجودة");
  const updated = await prisma.tenant.update({ where: { id: tenantId }, data: { enabledModules }, select: tenantSummarySelect });
  return mapTenantSummary(updated);
}

/** يحدّث بريد أول مستخدم (المُعتبَر "أدمن" الشركة) — وليس حقلاً منفصلاً على Tenant نفسه، لأن
 * adminEmail في الأساس هو بريد الهوية (Identity) المرتبطة بذلك المستخدم (راجع mapTenantSummary).
 * بما أن البريد أصبح خاصية على مستوى الهوية المشتركة بين كل عضويات نفس الشخص (بعد فصل Identity عن
 * User)، يُرفض التعديل صراحةً لو كانت هذه الهوية مرتبطة بأكثر من مستأجر — تغييره هنا كان سيُغيّر
 * بريد تسجيل الدخول لشركات أخرى غير هذه الشركة دون علم مالكها، وهذا خارج نطاق ما يعنيه "تعديل بريد
 * أدمن هذه الشركة تحديداً". يُسجَّل القيمتان القديمة والجديدة في سجل التدقيق (AuditLog) الخاص بأثر
 * المحاسبي نفسه، بنفس النمط المستخدم في بقية الوحدات (مثال: journalEntries.service.ts). */
export async function updateTenantAdminEmail(tenantId: string, newEmail: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw notFound("الشركة (Tenant) غير موجودة");

  const firstUser = await prisma.user.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    include: { identity: { include: { _count: { select: { memberships: true } } } } },
  });
  if (!firstUser) throw notFound("لا يوجد أي مستخدم مسجَّل لهذه الشركة بعد");

  const oldEmail = firstUser.identity.email;
  if (oldEmail === newEmail) return { adminEmail: newEmail };

  if (firstUser.identity._count.memberships > 1) {
    throw badRequest(
      "لا يمكن تعديل هذا البريد لأن حساب هذا المستخدم مرتبط بأكثر من شركة (نفس البريد وكلمة المرور) — تعديل البريد هنا كان سيُغيّر بريد تسجيل الدخول لكل تلك الشركات معاً.",
    );
  }

  const emailTaken = await prisma.identity.findUnique({ where: { email: newEmail } });
  if (emailTaken) throw conflict("هذا البريد الإلكتروني مستخدَم بالفعل بواسطة حساب آخر");

  const [updatedIdentity] = await prisma.$transaction([
    prisma.identity.update({ where: { id: firstUser.identityId }, data: { email: newEmail } }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId: firstUser.id,
        action: "platform_admin.update_admin_email",
        entityType: "User",
        entityId: firstUser.id,
        metadata: { oldEmail, newEmail },
      },
    }),
  ]);

  return { adminEmail: updatedIdentity.email };
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
