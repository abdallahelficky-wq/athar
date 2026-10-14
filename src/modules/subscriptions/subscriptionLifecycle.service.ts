import type { CompanySubscriptionStatus, Prisma, SubscriptionReminderKind } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { dueReminder, graceEndsAt, readOnlyReminderDue, statusAfterReactivation, statusByDate } from "../../lib/subscriptionLifecycle";
import { buildSubscriptionReminderEmail } from "../../lib/subscriptionReminderEmail";
import { sendSubscriptionReminderEmail } from "../../lib/mailer";
import type { Lang } from "../../lib/i18n/translate";

/**
 * دورة حياة الاشتراك لكل شركة (docs/design/subscription-plans.md §6، المرحلة P3): انتقالات الحالة بالتاريخ، وتذكيرات الانتهاء،
 * وتعليق/إعادة تفعيل. يعمل على صفوف company_subscriptions وحدها — وهي فارغة حتى ترحيل P11، فلا أثر على أي شركة قائمة اليوم،
 * ولا يمسّ حالة المستأجر (Tenant.subscriptionStatus) ولا isTenantReadOnly.
 */

const DAY_MS = 86_400_000;
const SYSTEM = "system_job";

type SendReminder = (to: string[], subject: string, bodyHtml: string, lang: Lang) => Promise<void>;

/** الانتقالات التي يجريها الوقت وحده، ونوع حدثها */
const TIME_TRANSITIONS: Partial<Record<CompanySubscriptionStatus, CompanySubscriptionStatus[]>> = {
  active: ["grace", "expired"],
  grace: ["expired"],
  trialing: ["expired"],
};

/**
 * يطبّق الحالة المستحقة بالتاريخ على كل صف تأخر عنها. كل انتقال مُطالَب بشرط (الحالة القديمة نفسها) فلا تنفّذه نسختان من الخادم
 * مرتين، ويُكتب حدثه في المعاملة نفسها. انتهاء فترة مدفوعة يُنهي السعر المحفوظ تاريخياً (D10).
 */
export async function applyTimeTransitions(now: Date): Promise<{ grace: number; expired: number }> {
  const candidates = await prisma.companySubscription.findMany({
    where: { status: { in: ["active", "grace", "trialing"] }, currentPeriodEnd: { not: null, lte: now } },
    select: { id: true, status: true, currentPeriodEnd: true, grandfatheredNetPrice: true },
  });
  const done = { grace: 0, expired: 0 };
  for (const row of candidates) {
    const target = statusByDate(row, now);
    if (target === row.status || !TIME_TRANSITIONS[row.status]?.includes(target)) continue;
    if (await claimTimeTransition(row, target, now)) done[target === "grace" ? "grace" : "expired"] += 1;
  }
  return done;
}

type TransitionSnapshot = { id: string; status: CompanySubscriptionStatus; grandfatheredNetPrice: Prisma.Decimal | null };

/**
 * يطبّق انتقالاً واحداً من لقطة قرأها المُجدوِل: التحديث مشروط بالحالة التي في اللقطة، فلو سبقته نسخة أخرى من الخادم (اللقطة
 * قديمة) يعود false بلا تحديث ولا حدث. مُصدَّرة ليُختبَر هذا الشرط بلقطة قديمة مباشرة.
 */
export async function claimTimeTransition(row: TransitionSnapshot, target: CompanySubscriptionStatus, now: Date): Promise<boolean> {
  const endsTerm = row.status === "active";
  return prisma.$transaction(async (tx) => {
    const claim = await tx.companySubscription.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: target, ...(endsTerm ? { grandfatheredNetPrice: null } : {}) },
    });
    if (claim.count !== 1) return false;
    await tx.subscriptionEvent.create({
      data: {
        companySubscriptionId: row.id,
        type: target === "grace" ? "grace_started" : "expired",
        before: { status: row.status, grandfatheredNetPrice: row.grandfatheredNetPrice?.toFixed(2) ?? null },
        after: { status: target, ...(endsTerm ? { grandfatheredNetPrice: null } : {}) },
        actor: SYSTEM,
        at: now,
      },
    });
    return true;
  });
}

/** مستلمو التذكير: مالك المستأجر ومديروه الفعّالون الذين نطاقهم كل الشركات أو هذه الشركة — من مستأجر الشركة وحده */
export async function reminderRecipients(companyId: string): Promise<string[]> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true, tenant: { select: { ownerId: true } } } });
  const users = await prisma.user.findMany({
    where: {
      tenantId: company.tenantId,
      active: true,
      inviteStatus: "accepted",
      deletedAt: null,
      companyScope: { in: ["all", companyId] },
      OR: [{ role: "admin" }, ...(company.tenant.ownerId ? [{ id: company.tenant.ownerId }] : [])],
    },
    select: { identity: { select: { email: true } } },
  });
  return [...new Set(users.map((u) => u.identity.email.toLowerCase()))].sort();
}

/**
 * يرسل التذكير المستحق لكل اشتراك (نافذة لكل نوع، §6). الصف في subscription_reminders يُحجَز قبل الإرسال (القيد الفريد يمنع
 * التكرار بين النسخ)، ويُحذف إن فشل الإرسال فيُعاد في النبضة التالية. خطأ شركة واحدة لا يوقف البقية.
 */
export async function sendDueReminders(now: Date, send: SendReminder = sendSubscriptionReminderEmail): Promise<{ sent: number; failed: number }> {
  const rows = await prisma.companySubscription.findMany({
    where: {
      status: { in: ["trialing", "active", "grace", "expired"] },
      currentPeriodEnd: { not: null, gte: new Date(now.getTime() - 30 * DAY_MS), lte: new Date(now.getTime() + 14 * DAY_MS) },
    },
    select: {
      id: true,
      companyId: true,
      status: true,
      currentPeriodEnd: true,
      company: { select: { name: true, language: true } },
      events: { where: { type: "expired" }, orderBy: { at: "desc" }, take: 1, select: { at: true, before: true } },
    },
  });
  const result = { sent: 0, failed: 0 };
  for (const row of rows) {
    const periodEnd = row.currentPeriodEnd!;
    let kind: SubscriptionReminderKind | null = dueReminder(row, now);
    let isTrial = row.status === "trialing";
    if (!kind && row.status === "expired") {
      const expiredEvent = row.events[0];
      const before = (expiredEvent?.before as Prisma.JsonObject | null)?.status;
      isTrial = before === "trialing";
      const readOnlySince = expiredEvent?.at ?? (isTrial ? periodEnd : graceEndsAt(periodEnd));
      if (readOnlyReminderDue(readOnlySince, now)) kind = "read_only";
    }
    if (!kind) continue;

    const claim = await prisma.subscriptionReminder.createMany({ data: [{ companySubscriptionId: row.id, kind, periodEnd }], skipDuplicates: true });
    if (claim.count !== 1) continue;
    try {
      const to = await reminderRecipients(row.companyId);
      const lang: Lang = row.company.language === "en" ? "en" : "ar";
      const email = buildSubscriptionReminderEmail(kind, row.company.name, periodEnd, lang, isTrial);
      await send(to, email.subject, email.bodyHtml, lang);
      result.sent += 1;
    } catch (err) {
      await prisma.subscriptionReminder.deleteMany({ where: { companySubscriptionId: row.id, kind, periodEnd } });
      result.failed += 1;
      // eslint-disable-next-line no-console
      console.error(`[subscriptionScheduler] فشل تذكير الاشتراك للشركة ${row.companyId} (${kind}):`, err);
    }
  }
  return result;
}

/** نبضة واحدة: الانتقالات أولاً ثم التذكيرات (فيُرسَل تذكير بدء السماح في النبضة نفسها التي بدأ فيها) */
export async function runSubscriptionLifecycle(now: Date = new Date(), send?: SendReminder) {
  const transitions = await applyTimeTransitions(now);
  const reminders = await sendDueReminders(now, send);
  return { ...transitions, ...reminders };
}

/**
 * نسخة صف قديمة في انتقال التعليق/التفعيل (P9، مراجعة #166): المدير أرسل نسخة الصف التي حمّلها، والنسخة الآن غيرها — أو تغيّرت بين
 * القراءة والكتابة (الفحص جزء من شرط التحديث نفسه، فلا نافذة بينهما). خدمة الإدارة تحوّله إلى 409 مع الصف الحالي.
 */
export class StaleSubscriptionVersionError extends Error {
  constructor() {
    super("stale subscription version");
  }
}

async function loadSubscription(companyId: string) {
  const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
  if (!sub) throw notFound("لا يوجد اشتراك لهذه الشركة");
  return sub;
}

/** تعليق إداري (§6): يحفظ الحالة السابقة في الحدث لتعود إليها إعادة التفعيل بالتاريخ */
export async function suspendCompanySubscription(companyId: string, reason: string, actor: string, now: Date = new Date(), expectedVersion?: number) {
  const sub = await loadSubscription(companyId);
  if (expectedVersion !== undefined && sub.version !== expectedVersion) throw new StaleSubscriptionVersionError();
  if (sub.status === "suspended") throw badRequest("الاشتراك معلّق بالفعل");
  return prisma.$transaction(async (tx) => {
    // النسخة (حين تُرسَل) في شرط التحديث نفسه مع الحالة: كاتب آخر بين القراءة والكتابة يُفشل المطالبة، لا يمرّ التعليق فوقه
    const claim = await tx.companySubscription.updateMany({
      where: { id: sub.id, status: sub.status, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
      data: { status: "suspended", suspensionReason: reason },
    });
    if (claim.count !== 1) {
      if (expectedVersion !== undefined) throw new StaleSubscriptionVersionError();
      throw badRequest("تغيّرت حالة الاشتراك أثناء الطلب — أعد المحاولة");
    }
    await tx.subscriptionEvent.create({
      data: { companySubscriptionId: sub.id, type: "suspended", before: { status: sub.status }, after: { status: "suspended", suspensionReason: reason }, actor, at: now },
    });
    return tx.companySubscription.findUniqueOrThrow({ where: { id: sub.id } });
  });
}

/**
 * إعادة التفعيل (§6): الحالة التي يستحقها الاشتراك بالتاريخ انطلاقاً من حالته قبل التعليق — نشط قبل النهاية، سماح خلال 7 أيام
 * بعدها، منتهٍ بعدها؛ والتجربة تعود تجربة أو منتهية. لا "نشط بلا نهاية" كما يفعل تفعيل المستأجر اليوم.
 */
export async function activateCompanySubscription(companyId: string, actor: string, now: Date = new Date(), expectedVersion?: number) {
  const sub = await loadSubscription(companyId);
  if (expectedVersion !== undefined && sub.version !== expectedVersion) throw new StaleSubscriptionVersionError();
  if (sub.status !== "suspended") throw badRequest("الاشتراك ليس معلّقاً");
  const lastSuspension = await prisma.subscriptionEvent.findFirst({
    where: { companySubscriptionId: sub.id, type: "suspended" },
    orderBy: { at: "desc" },
    select: { before: true },
  });
  const before = (lastSuspension?.before as Prisma.JsonObject | null)?.status as CompanySubscriptionStatus | undefined;
  // اشتراك مُرحَّل معلَّقاً بلا حدث تعليق: يُعامَل كفترة مدفوعة، فتحكمه نهايته
  const target = statusAfterReactivation(before ?? "active", sub.currentPeriodEnd, now);
  return prisma.$transaction(async (tx) => {
    const claim = await tx.companySubscription.updateMany({
      where: { id: sub.id, status: "suspended", ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
      data: { status: target, suspensionReason: null },
    });
    if (claim.count !== 1) {
      if (expectedVersion !== undefined) throw new StaleSubscriptionVersionError();
      throw badRequest("تغيّرت حالة الاشتراك أثناء الطلب — أعد المحاولة");
    }
    await tx.subscriptionEvent.create({
      data: { companySubscriptionId: sub.id, type: "activated", before: { status: "suspended" }, after: { status: target }, actor, at: now },
    });
    return tx.companySubscription.findUniqueOrThrow({ where: { id: sub.id } });
  });
}
