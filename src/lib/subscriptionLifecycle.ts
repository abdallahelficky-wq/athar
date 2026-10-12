import type { CompanySubscriptionStatus, SubscriptionReminderKind } from "@prisma/client";

/**
 * قواعد دورة حياة الاشتراك بالتاريخ (docs/design/subscription-plans.md §5.4 و§6) — دوال صافية. المُجدوِل (P3) يستخدمها ليبقي
 * عمود status صادقاً، والإنفاذ (P4) سيستخدم readOnlyAt بمقارنة التاريخ مباشرة فلا يعتمد على أن المُجدوِل قد عمل.
 */

export const GRACE_DAYS = 7; // D23
const DAY_MS = 86_400_000;

export type LifecycleRow = {
  status: CompanySubscriptionStatus;
  currentPeriodEnd: Date | null;
};

/** نهاية فترة السماح لفترة مدفوعة (نهاية الفترة + 7 أيام)؛ التجربة بلا سماح (D28) */
export function graceEndsAt(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() + GRACE_DAYS * DAY_MS);
}

/**
 * الحالة التي يستحقها الصف بالتاريخ وحده (§6): active → grace عند النهاية → expired بعد 7 أيام؛ trialing → expired عند النهاية بلا
 * سماح. بقية الحالات (awaiting_payment، expired، suspended، canceled) لا يغيّرها مرور الوقت. صف قديم بلا نهاية (legacy) يبقى كما هو.
 */
export function statusByDate(row: LifecycleRow, now: Date): CompanySubscriptionStatus {
  const end = row.currentPeriodEnd;
  if (!end) return row.status;
  if (row.status === "active" || row.status === "grace") {
    if (now < end) return "active";
    return now < graceEndsAt(end) ? "grace" : "expired";
  }
  if (row.status === "trialing") return now < end ? "trialing" : "expired";
  return row.status;
}

/**
 * عرض فقط؟ (§5.4) بالتاريخ مباشرة: expired/awaiting_payment/canceled دائماً، والتجربة من نهايتها، والفترة المدفوعة بعد السماح.
 * suspended ليس "عرض فقط" بل حجب دخول (يُعالَج في P4 مع الدخول)، فلا يُعدّ هنا.
 */
export function readOnlyAt(row: LifecycleRow, now: Date): boolean {
  if (row.status === "expired" || row.status === "awaiting_payment" || row.status === "canceled") return true;
  return statusByDate(row, now) === "expired";
}

/**
 * الحالة عند إعادة تفعيل اشتراك معلّق (§6): الحالة التي كان سيستحقها بالتاريخ انطلاقاً من حالته قبل التعليق — لا "نشط بلا نهاية"
 * كما يفعل تفعيل المستأجر اليوم. تجربة معلّقة تعود تجربة أو منتهية، ولا تصبح مدفوعة.
 */
export function statusAfterReactivation(statusBeforeSuspension: CompanySubscriptionStatus, periodEnd: Date | null, now: Date): CompanySubscriptionStatus {
  if (statusBeforeSuspension === "suspended") throw new Error("حالة ما قبل التعليق غير صالحة");
  return statusByDate({ status: statusBeforeSuspension, currentPeriodEnd: periodEnd }, now);
}

/**
 * التذكير المستحق الآن، إن وُجد (§6 الخطوة 3). كل تذكير له نافذة لا تتداخل مع غيره، فالنبضة الفائتة لا تُرسل تذكيرات قديمة
 * متراكمة: قبل 14 يوماً [نهاية−14، نهاية−7)، قبل 7 [نهاية−7، نهاية−1)، قبل يوم [نهاية−1، نهاية)، بدء السماح [نهاية، نهاية+7)
 * للمدفوعة، بدء العرض فقط خلال 7 أيام من بدئه. التكرار لنفس النافذة يمنعه جدول subscription_reminders.
 */
export function dueReminder(row: LifecycleRow & { status: CompanySubscriptionStatus }, now: Date): SubscriptionReminderKind | null {
  const end = row.currentPeriodEnd;
  if (!end) return null;
  const t = now.getTime();
  const e = end.getTime();
  const inWindow = (from: number, to: number) => t >= from && t < to;
  const paid = row.status === "active" || row.status === "grace";

  if (row.status === "active" || row.status === "trialing") {
    if (inWindow(e - 14 * DAY_MS, e - 7 * DAY_MS)) return "before_14";
    if (inWindow(e - 7 * DAY_MS, e - DAY_MS)) return "before_7";
    if (inWindow(e - DAY_MS, e)) return "before_1";
  }
  if (paid && inWindow(e, graceEndsAt(end).getTime())) return "grace_started";
  return null;
}

/** تذكير بدء العرض فقط: بعد أن يصبح الصف expired، خلال 7 أيام من بدء العرض فقط */
export function readOnlyReminderDue(readOnlySince: Date, now: Date): boolean {
  const t = now.getTime() - readOnlySince.getTime();
  return t >= 0 && t < 7 * DAY_MS;
}
