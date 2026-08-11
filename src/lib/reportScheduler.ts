import { prisma } from "./prisma";
import { buildReportDigestEmail, ReportDigestOptions } from "./reportDigest";
import { resolveRecipientEmails } from "../modules/reportSchedules/reportSchedules.service";
import { sendReportDigestEmail } from "./mailer";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة — كافٍ لأن أدق حبيبة زمنية مدعومة هي hourUtc (ساعة كاملة)

/** مفتاح فترة داخلي بحت لمنع إرسال مزدوج لنفس الأسبوع (وليس رقم أسبوع ISO 8601 معياري —
 * لا حاجة لذلك هنا، فهو غير مُعروض للمستخدم أبداً، فقط يُقارَن بنفسه بين نبضتين). */
function weekPeriodKey(date: Date): string {
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart.getTime()) / 86400000);
  return `${date.getUTCFullYear()}-W${Math.floor(daysSinceYearStart / 7)}`;
}

function periodKeyFor(frequency: "daily" | "weekly" | "monthly", now: Date): string {
  if (frequency === "daily") return now.toISOString().slice(0, 10);
  if (frequency === "weekly") return weekPeriodKey(now);
  return now.toISOString().slice(0, 7);
}

function isDue(schedule: { frequency: string; dayOfWeek: number; dayOfMonth: number; hourUtc: number }, now: Date): boolean {
  if (now.getUTCHours() !== schedule.hourUtc) return false;
  if (schedule.frequency === "daily") return true;
  if (schedule.frequency === "weekly") return now.getUTCDay() === schedule.dayOfWeek;
  // monthly — dayOfMonth محدود لـ 1-28 في المخطط، فيصلح لكل شهر بلا استثناء (حتى فبراير).
  return now.getUTCDate() === schedule.dayOfMonth;
}

async function runDueSchedules() {
  const now = new Date();
  const schedules = await prisma.reportSchedule.findMany({ where: { enabled: true, hourUtc: now.getUTCHours() } });

  for (const schedule of schedules) {
    if (!isDue(schedule, now)) continue;
    const periodKey = periodKeyFor(schedule.frequency, now);
    if (schedule.lastSentPeriodKey === periodKey) continue; // أُرسلت هذه الفترة بالفعل (مثلاً بعد إعادة تشغيل الخادم)

    try {
      const options: ReportDigestOptions = {
        includeComprehensiveMonthly: schedule.includeComprehensiveMonthly,
        includeTrialBalance: schedule.includeTrialBalance,
        includeIncomeStatement: schedule.includeIncomeStatement,
        includeBalanceSheet: schedule.includeBalanceSheet,
      };
      const recipients = await resolveRecipientEmails(schedule.tenantId, schedule.companyId, schedule.recipientEmails);
      if (recipients.length) {
        const email = await buildReportDigestEmail(schedule.tenantId, schedule.companyId, options);
        await sendReportDigestEmail(recipients, email.subject, email.bodyHtml);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[reportScheduler] لا يوجد مستلم صالح لجدولة الشركة ${schedule.companyId} — تم تخطي الإرسال`);
      }
      await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastSentAt: now, lastSentPeriodKey: periodKey } });
    } catch (err) {
      // خطأ في شركة واحدة لا يجب أن يوقف إرسال باقي الجدولات المستحقة في نفس النبضة.
      // eslint-disable-next-line no-console
      console.error(`[reportScheduler] فشل إرسال التقرير الدوري للشركة ${schedule.companyId}:`, err);
    }
  }
}

/** يبدأ نبضة ساعية تفحص جدولات التقارير المستحقة وترسلها — يُستدعى مرة واحدة عند إقلاع الخادم
 * (server.ts). التأخير الأول (5 دقائق) يعطي فرصة لاتصال قاعدة البيانات بالاستقرار بعد الإقلاع
 * مباشرة قبل أول فحص، بدل تشغيله فوراً في نفس لحظة استدعاء app.listen. */
export function startReportScheduler() {
  setTimeout(() => {
    runDueSchedules().catch((err) => console.error("[reportScheduler] فشل الفحص الدوري الأول:", err));
    setInterval(() => {
      runDueSchedules().catch((err) => console.error("[reportScheduler] فشل الفحص الدوري:", err));
    }, TICK_INTERVAL_MS);
  }, 5 * 60 * 1000);
}
