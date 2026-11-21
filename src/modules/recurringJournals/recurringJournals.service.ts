import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { toHalalas } from "../../lib/money";
import { HttpError } from "../../lib/httpError";
import { dateOnly, followingOccurrence, nextOccurrence, todayKsa, type Frequency } from "./recurrence";

/**
 * القيود الدورية: قالب (أسطر متوازنة + جدول تكرار) يُنشئ منه المُجدوِل قيداً عادياً في كل موعد.
 *
 * - القيد المُنشأ قيد يدوي عادي (sourceModule "manual") بتاريخ الموعد: يُعدَّل ويُفك ترحيله ويُعكَس ويُنسخ مرآةً كأي قيد يدوي.
 * - كل موعد يُحجَز بصف RecurringJournalRun فريد (templateId, periodDate) داخل معاملة إنشاء القيد نفسها ⇒ لا تكرار للموعد
 *   ولو عملت نسختان من الخادم أو ضُغط «تشغيل الآن» مع نبضة المُجدوِل.
 * - تعذّر الإنشاء (فترة مقفلة، حساب أُرشِف…) يُسجَّل في lastError ويتوقف القالب عند الموعد نفسه — لا يُتخطّى موعد بصمت.
 * - التدارك: موعد فات (الخادم كان متوقفاً، أو قالب بتاريخ بداية قديم) يُنشأ بتاريخه الأصلي، حتى MAX_CATCH_UP في المرة.
 */
export const MAX_CATCH_UP = 36;

export interface TemplateLineInput {
  accountId: string;
  costCenterId?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
}

export interface TemplateInput {
  companyId: string;
  name: string;
  memo?: string | null;
  frequency: Frequency;
  dayOfMonth: number;
  startDate: string;
  endDate?: string | null;
  autoPost: boolean;
  lines: TemplateLineInput[];
}

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

const templateInclude = {
  lines: { orderBy: { lineNo: "asc" as const }, include: { account: { select: { id: true, code: true, name: true } }, costCenter: { select: { id: true, name: true } } } },
};

async function validate(tenantId: string, input: TemplateInput) {
  if (input.lines.length < 2) throw badRequest("القيد يجب أن يحتوي على سطرين على الأقل");
  let debit = 0;
  let credit = 0;
  for (const l of input.lines) {
    const dr = toHalalas(l.debit || 0);
    const cr = toHalalas(l.credit || 0);
    if (dr < 0 || cr < 0) throw badRequest("المبالغ لا تكون سالبة");
    if ((dr > 0) === (cr > 0)) throw badRequest("كل سطر إما مدين أو دائن بمبلغ أكبر من صفر");
    debit += dr;
    credit += cr;
  }
  if (debit !== credit) throw badRequest("القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن");
  if (input.endDate && day(input.endDate) < day(input.startDate)) throw badRequest("تاريخ نهاية التكرار قبل بدايته");
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId }, select: { id: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await prisma.account.count({
    where: { id: { in: accountIds }, tenantId, companyId: input.companyId, isPosting: true, isActive: true, isArchived: false },
  });
  if (accounts !== accountIds.length) throw badRequest("أحد حسابات القيد لا ينتمي إلى شجرة الشركة أو ليس حساب ترحيل نشطاً");
  const costCenterIds = [...new Set(input.lines.map((l) => l.costCenterId).filter((c): c is string => Boolean(c)))];
  if (costCenterIds.length) {
    const ccs = await prisma.costCenter.count({ where: { id: { in: costCenterIds }, tenantId } });
    if (ccs !== costCenterIds.length) throw badRequest("مركز التكلفة غير موجود");
  }
}

function lineRows(tenantId: string, companyId: string, lines: TemplateLineInput[]) {
  return lines.map((l, i) => ({
    tenantId,
    companyId,
    lineNo: i + 1,
    accountId: l.accountId,
    costCenterId: l.costCenterId || null,
    description: l.description?.trim() || null,
    debit: new Prisma.Decimal(l.debit || 0),
    credit: new Prisma.Decimal(l.credit || 0),
  }));
}

export async function listTemplates(tenantId: string, companyId: string) {
  return prisma.recurringJournalTemplate.findMany({
    where: { tenantId, companyId },
    orderBy: [{ active: "desc" }, { nextRunDate: "asc" }, { name: "asc" }],
    include: { ...templateInclude, _count: { select: { runs: true } } },
  });
}

export async function getTemplate(tenantId: string, id: string) {
  const template = await prisma.recurringJournalTemplate.findFirst({
    where: { id, tenantId },
    include: {
      ...templateInclude,
      runs: {
        orderBy: { periodDate: "desc" },
        take: 60,
        include: { journalEntry: { select: { id: true, entryNumber: true, status: true } } },
      },
    },
  });
  if (!template) throw notFound("القيد الدوري غير موجود");
  return template;
}

export async function createTemplate(tenantId: string, userId: string, input: TemplateInput) {
  await validate(tenantId, input);
  const schedule = { startDate: day(input.startDate), endDate: input.endDate ? day(input.endDate) : null, frequency: input.frequency, dayOfMonth: input.dayOfMonth };
  const created = await prisma.recurringJournalTemplate.create({
    data: {
      tenantId,
      companyId: input.companyId,
      name: input.name.trim(),
      memo: input.memo?.trim() || null,
      ...schedule,
      nextRunDate: nextOccurrence(schedule, schedule.startDate),
      autoPost: input.autoPost,
      createdById: userId,
      lines: { create: lineRows(tenantId, input.companyId, input.lines) },
    },
  });
  return getTemplate(tenantId, created.id);
}

export async function updateTemplate(tenantId: string, id: string, input: TemplateInput) {
  const existing = await prisma.recurringJournalTemplate.findFirst({
    where: { id, tenantId },
    include: { runs: { orderBy: { periodDate: "desc" }, take: 1, select: { periodDate: true } } },
  });
  if (!existing) throw notFound("القيد الدوري غير موجود");
  if (input.companyId !== existing.companyId) throw badRequest("لا يمكن نقل القيد الدوري لشركة أخرى");
  await validate(tenantId, input);
  const schedule = { startDate: day(input.startDate), endDate: input.endDate ? day(input.endDate) : null, frequency: input.frequency, dayOfMonth: input.dayOfMonth };
  // الجدول الجديد يُكمل بعد آخر موعد نُفِّذ — تعديل القالب لا يُعيد إنشاء مواعيد سابقة
  const lastRun = existing.runs[0]?.periodDate;
  const nextRunDate = lastRun ? followingOccurrence(schedule, lastRun) : nextOccurrence(schedule, schedule.startDate);
  await prisma.$transaction(async (tx) => {
    await tx.recurringJournalTemplateLine.deleteMany({ where: { templateId: id } });
    await tx.recurringJournalTemplate.update({
      where: { id },
      data: {
        name: input.name.trim(),
        memo: input.memo?.trim() || null,
        ...schedule,
        nextRunDate,
        autoPost: input.autoPost,
        lastError: null,
        lines: { create: lineRows(tenantId, existing.companyId, input.lines) },
      },
    });
  });
  return getTemplate(tenantId, id);
}

export async function setActive(tenantId: string, id: string, active: boolean) {
  const existing = await prisma.recurringJournalTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw notFound("القيد الدوري غير موجود");
  await prisma.recurringJournalTemplate.update({ where: { id }, data: { active, ...(active ? { lastError: null } : {}) } });
  return getTemplate(tenantId, id);
}

export async function deleteTemplate(tenantId: string, id: string) {
  const existing = await prisma.recurringJournalTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw notFound("القيد الدوري غير موجود");
  // القيود المُنشأة سابقاً تبقى في الدفاتر كما هي — يُحذف القالب وسجل مواعيده فقط
  await prisma.recurringJournalTemplate.delete({ where: { id } });
}

type LoadedTemplate = Prisma.RecurringJournalTemplateGetPayload<{ include: { lines: true } }>;

/** ينشئ قيد موعد واحد ذرّياً مع حجز الموعد. يرجع false لو كان الموعد محجوزاً مسبقاً (نسخة أخرى سبقت). */
async function generateOccurrence(template: LoadedTemplate, periodDate: Date): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const run = await tx.recurringJournalRun.create({
        data: { templateId: template.id, tenantId: template.tenantId, companyId: template.companyId, periodDate },
      });
      const entry = await createJournalEntryTx(tx, {
        tenantId: template.tenantId,
        companyId: template.companyId,
        date: periodDate,
        memo: template.memo || template.name,
        sourceModule: "manual",
        createdBy: template.createdById ?? undefined,
        lines: template.lines.map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId,
          lineDescription: l.description,
          debit: Number(l.debit),
          credit: Number(l.credit),
        })),
      });
      if (!template.autoPost) await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "saved" } });
      await tx.recurringJournalRun.update({ where: { id: run.id }, data: { journalEntryId: entry.id } });
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

/**
 * ينشئ كل المواعيد المستحقة (≤ asOf) لقالب واحد، ويحرّك nextRunDate. يتوقف عند أول خطأ ويسجّله في lastError.
 */
export async function runTemplate(templateId: string, asOf: Date = todayKsa()) {
  const template = await prisma.recurringJournalTemplate.findUnique({ where: { id: templateId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!template || !template.active || !template.nextRunDate) return { created: 0, error: null as string | null };
  const schedule = { startDate: template.startDate, endDate: template.endDate, frequency: template.frequency as Frequency, dayOfMonth: template.dayOfMonth };
  let next: Date | null = dateOnly(template.nextRunDate);
  let created = 0;
  let error: string | null = null;
  while (next && next <= dateOnly(asOf) && created < MAX_CATCH_UP) {
    try {
      if (await generateOccurrence(template, next)) created += 1;
    } catch (err) {
      error = err instanceof HttpError ? err.message : "تعذّر إنشاء القيد الدوري";
      if (!(err instanceof HttpError)) console.error(`[recurringJournals] فشل إنشاء موعد ${next.toISOString().slice(0, 10)} للقالب ${template.id}:`, err);
      break;
    }
    next = followingOccurrence(schedule, next);
  }
  await prisma.recurringJournalTemplate.update({
    where: { id: template.id },
    data: { nextRunDate: next, lastError: error, ...(created ? { lastRunAt: new Date() } : {}) },
  });
  return { created, error };
}

/** «تشغيل الآن» من الشاشة — نفس مسار المُجدوِل لقالب واحد من المستأجر */
export async function runTemplateNow(tenantId: string, id: string) {
  const existing = await prisma.recurringJournalTemplate.findFirst({ where: { id, tenantId }, select: { id: true, active: true } });
  if (!existing) throw notFound("القيد الدوري غير موجود");
  if (!existing.active) throw badRequest("القيد الدوري موقوف — فعّله أولاً");
  const result = await runTemplate(id);
  return { ...result, template: await getTemplate(tenantId, id) };
}

/** نبضة المُجدوِل: كل القوالب المفعّلة التي حان موعدها اليوم (بتوقيت السعودية) */
export async function runDueRecurringJournals(now: Date = new Date()) {
  const asOf = todayKsa(now);
  const due = await prisma.recurringJournalTemplate.findMany({
    where: { active: true, nextRunDate: { lte: asOf } },
    select: { id: true },
    take: 500,
  });
  let created = 0;
  for (const t of due) {
    try {
      created += (await runTemplate(t.id, asOf)).created;
    } catch (err) {
      console.error(`[recurringJournals] فشل تشغيل القالب ${t.id}:`, err);
    }
  }
  return { templates: due.length, created };
}
