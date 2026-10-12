import type { SubscriptionReminderKind } from "@prisma/client";
import type { Lang } from "./i18n/translate";
import { graceEndsAt } from "./subscriptionLifecycle";
import { riyadhCalendarDay } from "./riyadhDate";

/** نص تذكير انتهاء الاشتراك (§6 الخطوة 3) — دالة صافية يختبرها الاختبار مباشرة، والمُجدوِل يرسل ناتجها كما هو */
export function buildSubscriptionReminderEmail(kind: SubscriptionReminderKind, companyName: string, periodEnd: Date, lang: Lang, isTrial = false): { subject: string; bodyHtml: string } {
  const end = riyadhCalendarDay(periodEnd);
  const readOnlyFrom = riyadhCalendarDay(isTrial ? periodEnd : graceEndsAt(periodEnd));
  const name = escapeHtml(companyName);
  const en = lang === "en";
  const what = isTrial ? (en ? "free trial" : "الفترة التجريبية") : en ? "subscription" : "الاشتراك";
  // مطابقة الفعل لجنس الاسم: الفترة (مؤنث) تنتهي/انتهت، والاشتراك (مذكر) ينتهي/انتهى
  const ends = isTrial ? "تنتهي" : "ينتهي";
  const ended = isTrial ? "انتهت" : "انتهى";
  const lines: Record<SubscriptionReminderKind, { subject: string; body: string }> = en
    ? {
        before_14: { subject: `${name}: ${what} ends in 14 days`, body: `The ${what} of <b>${name}</b> ends on <b>${end}</b>.` },
        before_7: { subject: `${name}: ${what} ends in 7 days`, body: `The ${what} of <b>${name}</b> ends on <b>${end}</b>.` },
        before_1: { subject: `${name}: ${what} ends tomorrow`, body: `The ${what} of <b>${name}</b> ends on <b>${end}</b>.` },
        grace_started: { subject: `${name}: subscription ended — read-only from ${readOnlyFrom}`, body: `The subscription of <b>${name}</b> ended on <b>${end}</b>. You can keep working until <b>${readOnlyFrom}</b>; after that the company becomes read-only unless the renewal is paid.` },
        read_only: { subject: `${name}: company is now read-only`, body: `The ${what} of <b>${name}</b> has ended. The company is read-only: all data can still be viewed and exported, but nothing can be added or changed until it is renewed.` },
      }
    : {
        before_14: { subject: `${name}: ${ends} ${what} بعد 14 يوماً`, body: `${ends} ${what} لشركة <b>${name}</b> في <b>${end}</b>.` },
        before_7: { subject: `${name}: ${ends} ${what} بعد 7 أيام`, body: `${ends} ${what} لشركة <b>${name}</b> في <b>${end}</b>.` },
        before_1: { subject: `${name}: ${ends} ${what} غداً`, body: `${ends} ${what} لشركة <b>${name}</b> في <b>${end}</b>.` },
        grace_started: { subject: `${name}: انتهى الاشتراك — عرض فقط من ${readOnlyFrom}`, body: `انتهى اشتراك شركة <b>${name}</b> في <b>${end}</b>. يمكنك الاستمرار في العمل حتى <b>${readOnlyFrom}</b>، ثم تتحول الشركة إلى عرض فقط ما لم يُسدَّد التجديد.` },
        read_only: { subject: `${name}: الشركة الآن في وضع العرض فقط`, body: `${ended} ${what} لشركة <b>${name}</b>. الشركة الآن في وضع العرض فقط: كل البيانات متاحة للاطلاع والتصدير، ولا يمكن إضافة أو تعديل شيء حتى التجديد.` },
      };
  const { subject, body } = lines[kind];
  return { subject, bodyHtml: `<p style="line-height:1.8">${body}</p>` };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
