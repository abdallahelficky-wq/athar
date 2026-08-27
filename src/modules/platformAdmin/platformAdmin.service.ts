import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import type { Prisma, Tenant } from "@prisma/client";

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
  // أول مستخدم سجَّل لهذه الشركة (المُنشَأ ضمن نفس معاملة التسجيل نفسها في auth.service.ts —
  // يحمل دائماً دور admin أو super_admin) — نجلب بريده الإلكتروني فقط لعرضه كـ adminEmail.
  users: { select: { email: true }, orderBy: { createdAt: "asc" }, take: 1 },
} satisfies Prisma.TenantSelect;

type TenantSummaryRaw = Prisma.TenantGetPayload<{ select: typeof tenantSummarySelect }>;

/** يُحوِّل نتيجة Prisma الخام (تتضمن مصفوفة users بعنصر واحد كحد أقصى) إلى شكل الاستجابة العلني:
 * adminEmail مباشرة بدل مصفوفة users. */
function mapTenantSummary(tenant: TenantSummaryRaw) {
  const { users, ...rest } = tenant;
  return { ...rest, adminEmail: users[0]?.email ?? null };
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
 * adminEmail في الأساس هو بريد ذلك المستخدم بالضبط (راجع mapTenantSummary). يُسجَّل القيمتان
 * القديمة والجديدة في سجل التدقيق (AuditLog) الخاص بأثر المحاسبي نفسه، بنفس النمط المستخدم في
 * بقية الوحدات (مثال: journalEntries.service.ts). */
export async function updateTenantAdminEmail(tenantId: string, newEmail: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw notFound("الشركة (Tenant) غير موجودة");

  const firstUser = await prisma.user.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  if (!firstUser) throw notFound("لا يوجد أي مستخدم مسجَّل لهذه الشركة بعد");

  const oldEmail = firstUser.email;
  if (oldEmail === newEmail) return { adminEmail: newEmail };

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({ where: { id: firstUser.id }, data: { email: newEmail } }),
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

  return { adminEmail: updatedUser.email };
}

const DELETABLE_STATUS: Tenant["subscriptionStatus"] = "trialing";

/**
 * حذف نهائي كامل لشركة (Tenant) وكل بياناتها — مسموح فقط للشركات التجريبية (trialing)، ويُتحقَّق
 * من هذا الشرط هنا في الخادم صراحةً (بلا أي ثقة بما يرسله الطرف المستدعي) لمنع حذف أي شركة دفعت
 * فعلياً أو مُعلَّقة إدارياً بالخطأ. الحذف الفعلي عملية DELETE ذرّية واحدة تعتمد على cascading
 * foreign keys (onDelete: Cascade مضبوطة على كل الـ 47 علاقة المرتبطة بـ Tenant في schema.prisma)
 * — Postgres نفسه يحذف كل الجداول التابعة تلقائياً وبشكل ذرّي بالكامل ضمن نفس العملية، فلا حاجة
 * لتعداد كل جدول يدوياً، ولا احتمال لحذف جزئي (فشل أي قيد يُرجع كل شيء تلقائياً).
 *
 * ⚠️ ملاحظة مهمة: أي ملفات مخزَّنة خارجياً (مرفقات، شعارات شركات، ...) في التخزين السحابي (R2/S3)
 * لن تُحذف مع هذه العملية — سجلاتها في قاعدة البيانات فقط هي ما يُحذف، فتبقى الملفات الفعلية
 * "يتيمة" في التخزين الخارجي. تنظيفها يحتاج خطوة منفصلة خارج نطاق هذه الدالة.
 *
 * ⚠️ ملاحظة أخرى: سجل التدقيق (AuditLog) نفسه مرتبط بـ Tenant عبر onDelete: Cascade، فسجل "محاولة
 * الحذف" الذي نكتبه هنا قبل التنفيذ سيُحذف تلقائياً بمجرد نجاح حذف الـ Tenant لاحقاً — هو مفيد فقط
 * كأثر يبقى لو فشلت عملية الحذف أو تم التراجع عنها، وليس كسجل دائم بعد نجاح الحذف الفعلي.
 */
export async function deleteTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw notFound("الشركة (Tenant) غير موجودة");

  if (tenant.subscriptionStatus !== DELETABLE_STATUS) {
    throw badRequest(
      `لا يمكن حذف هذه الشركة نهائياً إلا إذا كانت حالة اشتراكها "تجريبي" (trialing) — حالتها الحالية: "${tenant.subscriptionStatus}". أوقف الاشتراك أو غيّر حالته أولاً لو كنت متأكداً من رغبتك في الحذف رغم ذلك.`,
    );
  }

  // كتابة منفصلة (commit مستقل) قبل بدء الحذف الفعلي — راجع الملاحظة أعلاه بخصوص Cascade.
  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: null,
      action: "platform_admin.delete_tenant_attempt",
      entityType: "Tenant",
      entityId: tenantId,
      metadata: { tenantName: tenant.name, subscriptionStatus: tenant.subscriptionStatus },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.tenant.delete({ where: { id: tenantId } });
  });
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
