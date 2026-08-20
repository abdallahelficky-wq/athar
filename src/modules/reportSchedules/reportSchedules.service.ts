import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { buildReportDigestEmail, ReportDigestOptions } from "../../lib/reportDigest";
import { sendReportDigestEmail } from "../../lib/mailer";
import type { Lang } from "../../lib/i18n/translate";

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  return company;
}

const DEFAULTS = {
  frequency: "monthly" as const,
  dayOfWeek: 0,
  dayOfMonth: 1,
  hourKsa: 6,
  includeComprehensiveMonthly: true,
  includeTrialBalance: true,
  includeIncomeStatement: true,
  includeBalanceSheet: true,
  recipientEmails: [] as string[],
  enabled: true,
};

export async function getReportSchedule(tenantId: string, companyId: string) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  const existing = await prisma.reportSchedule.findUnique({ where: { companyId } });
  if (existing) return existing;
  return { id: null, tenantId, companyId, lastSentAt: null, lastSentPeriodKey: null, ...DEFAULTS };
}

interface ScheduleInput {
  frequency: "daily" | "weekly" | "monthly";
  dayOfWeek: number;
  dayOfMonth: number;
  hourKsa: number;
  includeComprehensiveMonthly: boolean;
  includeTrialBalance: boolean;
  includeIncomeStatement: boolean;
  includeBalanceSheet: boolean;
  recipientEmails: string[];
  enabled: boolean;
}

export async function upsertReportSchedule(tenantId: string, companyId: string, input: ScheduleInput) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  return prisma.reportSchedule.upsert({
    where: { companyId },
    create: { tenantId, companyId, ...input },
    update: { ...input },
  });
}

/**
 * لو recipientEmails فارغة في الجدولة، تُرسَل الرسالة تلقائياً لكل مستخدمي هذا المستأجر النشطين
 * بدور admin/finance_manager/super_admin الذين يغطي نطاقهم (companyScope) هذه الشركة تحديداً —
 * بدل إجبار كل شركة على تكرار إدخال نفس القوائم البريدية يدوياً.
 */
export async function resolveRecipientEmails(tenantId: string, companyId: string, recipientEmails: string[]): Promise<string[]> {
  if (recipientEmails.length) return recipientEmails;
  const users = await prisma.user.findMany({
    where: {
      tenantId,
      active: true,
      role: { in: ["admin", "finance_manager", "super_admin"] },
      OR: [{ companyScope: "all" }, { companyScope: companyId }],
    },
    select: { email: true },
  });
  return [...new Set(users.map((u) => u.email))];
}

/** يُستدعى من زر "إرسال الآن" في شاشة الإعدادات لاختبار الجدولة فوراً دون انتظار موعدها،
 * ومن نفس المسار الذي يستخدمه المُجدوِل التلقائي في reportScheduler.ts — لكن دون تحديث
 * lastSentAt/lastSentPeriodKey هنا (اختبار يدوي لا يجب أن "يستهلك" الإرسال المجدول القادم). */
export async function sendReportScheduleNow(tenantId: string, companyId: string) {
  const company = await assertCompanyBelongsToTenant(tenantId, companyId);
  const lang = (company.language as Lang) ?? "ar";
  const schedule = await prisma.reportSchedule.findUnique({ where: { companyId } });
  const options: ReportDigestOptions = schedule
    ? {
        includeComprehensiveMonthly: schedule.includeComprehensiveMonthly,
        includeTrialBalance: schedule.includeTrialBalance,
        includeIncomeStatement: schedule.includeIncomeStatement,
        includeBalanceSheet: schedule.includeBalanceSheet,
      }
    : {
        includeComprehensiveMonthly: DEFAULTS.includeComprehensiveMonthly,
        includeTrialBalance: DEFAULTS.includeTrialBalance,
        includeIncomeStatement: DEFAULTS.includeIncomeStatement,
        includeBalanceSheet: DEFAULTS.includeBalanceSheet,
      };

  const recipients = await resolveRecipientEmails(tenantId, companyId, schedule?.recipientEmails ?? []);
  if (!recipients.length) throw badRequest("لا يوجد أي مستلم بريد إلكتروني صالح — أضِف بريداً في الإعدادات أو تأكد من وجود مستخدم بدور مدير/مدير حسابات لهذه الشركة");

  const email = await buildReportDigestEmail(tenantId, companyId, options, lang);
  await sendReportDigestEmail(recipients, email.subject, email.bodyHtml, lang);
  return { sentTo: recipients };
}
