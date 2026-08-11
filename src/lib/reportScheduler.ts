import { prisma } from "./prisma";
import { buildReportDigestEmail, ReportDigestOptions } from "./reportDigest";
import { resolveRecipientEmails } from "../modules/reportSchedules/reportSchedules.service";
import { sendReportDigestEmail } from "./mailer";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة — كافٍ لأن أدق حبيبة زمنية مدعومة هي hourKsa (ساعة كاملة)

// توقيت السعودية (AST) ثابت UTC+3 طوال العام بلا أي توقيت صيفي — كل حقول الجدولة
// (dayOfWeek/dayOfMonth/hourKsa) مخزَّنة بهذا التوقيت مباشرة (انظر التعليق فوق ReportSchedule في
// schema.prisma)، فلا حاجة لأي تحويل معاكس هنا؛ فقط نزيح "الآن" (UTC) بنفس المقدار قبل المقارنة.
const KSA_OFFSET_MS = 3 * 60 * 60 * 1000;

interface KsaNow {
  hour: number;
  dayOfWeek: number; // 0=الأحد..6=السبت
  dayOfMonth: number;
  shifted: Date; // طابع الوقت بعد الإزاحة — يُستخدَم فقط لاستخراج مفتاح الفترة (ISO)، لا لعرضه
}

/** إضافة الإزاحة الثابتة لطابع UTC الزمني ثم قراءة حقول UTC منه تُعطي "الوقت كما لو كان في
 * السعودية" مباشرة، دون أي مكتبة مناطق زمنية — الحيلة القياسية لإزاحة ثابتة بلا DST. */
function getKsaNow(utcNow: Date): KsaNow {
  const shifted = new Date(utcNow.getTime() + KSA_OFFSET_MS);
  return { hour: shifted.getUTCHours(), dayOfWeek: shifted.getUTCDay(), dayOfMonth: shifted.getUTCDate(), shifted };
}

/** مفتاح فترة داخلي بحت لمنع إرسال مزدوج لنفس الأسبوع (وليس رقم أسبوع ISO 8601 معياري —
 * لا حاجة لذلك هنا، فهو غير مُعروض للمستخدم أبداً، فقط يُقارَن بنفسه بين نبضتين). */
function weekPeriodKey(ksaShifted: Date): string {
  const yearStart = new Date(Date.UTC(ksaShifted.getUTCFullYear(), 0, 1));
  const daysSinceYearStart = Math.floor((ksaShifted.getTime() - yearStart.getTime()) / 86400000);
  return `${ksaShifted.getUTCFullYear()}-W${Math.floor(daysSinceYearStart / 7)}`;
}

function periodKeyFor(frequency: "daily" | "weekly" | "monthly", ksaShifted: Date): string {
  if (frequency === "daily") return ksaShifted.toISOString().slice(0, 10);
  if (frequency === "weekly") return weekPeriodKey(ksaShifted);
  return ksaShifted.toISOString().slice(0, 7);
}

/**
 * "مستحقة" لو موعدها بتوقيت السعودية وصل أو مضى بالفعل خلال الفترة الحالية (وليس فقط عند
 * التطابق الحرفي مع الساعة الحالية) — لو تطابقت السطر الأخير للمقارنة، نفحص الساعة أيضاً؛ لو
 * تجاوزنا يوم/تاريخ الاستحقاق فعلاً هذه الفترة، نعتبرها مستحقة بصرف النظر عن الساعة الحالية.
 * هذا يلتقط الفترة الفائتة تلقائياً في أول نبضة بعد انقطاع الخادم أو إعادة تشغيله قرب حدود
 * الساعة، بدل تخطّي الفترة كاملة (كانت المقارنة السابقة == صارمة على الساعة فقط). الحماية من
 * التكرار تبقى عبر lastSentPeriodKey أدناه، لا عبر هذا الشرط.
 */
function isDue(schedule: { frequency: string; dayOfWeek: number; dayOfMonth: number; hourKsa: number }, ksaNow: KsaNow): boolean {
  if (schedule.frequency === "daily") return ksaNow.hour >= schedule.hourKsa;
  if (schedule.frequency === "weekly") {
    if (ksaNow.dayOfWeek < schedule.dayOfWeek) return false;
    if (ksaNow.dayOfWeek > schedule.dayOfWeek) return true;
    return ksaNow.hour >= schedule.hourKsa;
  }
  // monthly — dayOfMonth محدود لـ 1-28 في المخطط، فيصلح لكل شهر بلا استثناء (حتى فبراير).
  if (ksaNow.dayOfMonth < schedule.dayOfMonth) return false;
  if (ksaNow.dayOfMonth > schedule.dayOfMonth) return true;
  return ksaNow.hour >= schedule.hourKsa;
}

async function runDueSchedules() {
  const utcNow = new Date();
  const ksaNow = getKsaNow(utcNow);
  // لا نُصفّي بالساعة الحالية هنا (خلافاً لتصميم سابق) لأن اللحاق بفترة فائتة (isDue أعلاه)
  // يحتاج فحص كل الجدولات المفعّلة بصرف النظر عن ساعتها المضبوطة، لا الجدولات المطابقة للساعة
  // الحالية فقط. الجدول صغير جداً عملياً (سجل واحد لكل شركة)، فلا تكلفة حقيقية لفحصه كاملاً.
  const schedules = await prisma.reportSchedule.findMany({ where: { enabled: true } });

  for (const schedule of schedules) {
    if (!isDue(schedule, ksaNow)) continue;
    const periodKey = periodKeyFor(schedule.frequency, ksaNow.shifted);
    if (schedule.lastSentPeriodKey === periodKey) continue; // أُرسلت هذه الفترة بالفعل

    // مطالبة ذرّية بهذه الفترة قبل الإرسال الفعلي — لو نسختان من الخادم (أو نبضتان متداخلتان)
    // قرأتا معاً نفس lastSentPeriodKey القديم أعلاه، شرط WHERE هنا يضمن نجاح UPDATE واحدة فقط
    // فعلياً (Postgres تُنفّذ كل UPDATE كعملية ذرّية على مستوى الصف)؛ الخاسرة تحصل على count:0
    // فتتخطى الإرسال بدل تكراره. نطالب بالفترة قبل الإرسال عمداً حتى لو فشل الإرسال لاحقاً (بلا
    // تراجع) — تفادي إرسال مزدوج أهم هنا من ضمان إعادة محاولة تلقائية؛ زر "إرسال الآن" متاح
    // كبديل يدوي لو فشل إرسال فعلي فعلاً.
    const claim = await prisma.reportSchedule.updateMany({
      where: { id: schedule.id, OR: [{ lastSentPeriodKey: null }, { lastSentPeriodKey: { not: periodKey } }] },
      data: { lastSentAt: utcNow, lastSentPeriodKey: periodKey },
    });
    if (claim.count === 0) continue; // نسخة/نبضة أخرى سبقتنا لنفس الفترة

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
