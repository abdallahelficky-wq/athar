import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { COUNTED_ENTRY_WHERE } from "../../lib/countedEntries";
import { lockCompanyClosingDate, fmtDateOnly } from "../../lib/fiscalClosing";
import { reserveEntryNumber } from "../../lib/journalPosting";
import { recomputeEntryTotal } from "../../lib/journalEntryTotals";
import { fiscalYearContaining, normalizeStartMonth, todayRiyadh, type FiscalYearBounds } from "../../lib/fiscalYear";

/**
 * إقفال السنة المالية.
 *
 * دفتر الأستاذ في أثر تراكمي: رصيد أي حساب في أي تاريخ = مجموع كل قيوده حتى ذلك التاريخ. لذلك أرصدة
 * حسابات المركز المالي (أصول، التزامات، حقوق ملكية) تنتقل للسنة التالية تلقائياً دون قيد افتتاحي — قيد
 * افتتاحي فوقها كان سيضاعفها. ما يحتاجه الإقفال فعلاً هو تصفير الإيرادات والمصروفات في حساب الإقفال:
 *
 * - قيد واحد بتاريخ نهاية السنة (sourceModule = fiscal_year_closing) يعكس صافي كل حساب إيراد/مصروف
 *   (مجمَّعاً لكل فرع ومركز تكلفة وقسم حتى تبقى تقارير الأبعاد صفرية بعد الإقفال)، ويُقابله سطر حساب
 *   الإقفال لكل فرع بصافي الربح أو الخسارة.
 * - الصافي يُحسب تراكمياً حتى نهاية السنة (بما فيه قيود إقفال السنوات السابقة) — فهو صافي هذه السنة وحدها.
 * - قائمة الدخل ولوحات الإيرادات تستبعد قيود الإقفال؛ ميزان المراجعة والأستاذ والمركز المالي تحتسبها
 *   (فصافي الربح في المركز المالي = ربح الفترة منذ آخر إقفال، وما قبله في حساب الإقفال).
 * - يُقدَّم تاريخ قفل الفترات إلى نهاية السنة، فلا يُضاف قيد في السنة المقفلة بعد إقفالها.
 * - الإقفال تسلسلي، ولا يُعاد فتح إلا آخر سنة مقفلة (يحذف قيدها ويستعيد تاريخ القفل السابق).
 *
 * المرآة والعكس: قيد الإقفال لا يُنشأ له قيد مرآة ولا يُعكَس ولا يُعدَّل ولا يُفَك ترحيله من شاشة القيود
 * (FISCAL_CLOSING_ENTRY_LOCKED في journalEntries.service.ts). قيود المرآة الواردة من شركة أخرى قيود
 * عادية في شركتها فتدخل صافي إقفالها؛ والعكس داخل السنة يُلغي أصله في الصافي.
 */

type Db = Prisma.TransactionClient | PrismaClient;

export const FISCAL_YEAR_NOT_ENDED = "لا يمكن إقفال سنة مالية لم تنتهِ بعد";
export const FISCAL_YEAR_HAS_DRAFTS = "توجد قيود محفوظة غير مرحّلة داخل السنة — رحّلها أو احذفها قبل الإقفال";
export const FISCAL_CLOSE_ACCOUNT_REQUIRED = "اختر حساب الإقفال (حساب حقوق ملكية) قبل إقفال السنة";
export const FISCAL_CLOSE_ACCOUNT_INVALID = "حساب الإقفال يجب أن يكون حساب ترحيل نشطاً من نوع حقوق الملكية في نفس الشركة";
export const FISCAL_NOTHING_TO_CLOSE = "لا توجد قيود في هذه الشركة — لا توجد سنة مالية لإقفالها";
export const FISCAL_YEAR_STALE = "تغيّرت السنة المالية التالية للإقفال — حدّث الصفحة وراجع المعاينة من جديد";
export const FISCAL_NO_CLOSED_YEAR = "لا توجد سنة مالية مقفلة لإعادة فتحها";
export const FISCAL_START_MONTH_LOCKED = "لا يمكن تغيير شهر بداية السنة المالية بعد إقفال سنة — أعد فتح السنوات المقفلة أولاً";
export const FISCAL_START_MONTH_INVALID = "شهر بداية السنة المالية يجب أن يكون من 1 إلى 12";

const cents = (value: Prisma.Decimal | number) => Math.round(Number(value) * 100);
const fromCents = (value: number) => value / 100;

async function loadCompany(db: Db, tenantId: string, companyId: string) {
  const company = await db.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw notFound("الشركة غير موجودة");
  return company;
}

async function lastClosing(db: Db, companyId: string) {
  return db.fiscalYearClosing.findFirst({ where: { companyId }, orderBy: { yearEnd: "desc" } });
}

/** السنة التالية للإقفال: التي تلي آخر سنة مقفلة، أو أول سنة فيها قيد. */
async function nextYearToClose(db: Db, tenantId: string, companyId: string, startMonth: number): Promise<FiscalYearBounds | null> {
  const last = await lastClosing(db, companyId);
  if (last) return fiscalYearContaining(new Date(last.yearEnd.getTime() + 86_400_000), startMonth);
  const first = await db.journalEntry.findFirst({ where: { tenantId, companyId }, orderBy: { date: "asc" }, select: { date: true } });
  return first ? fiscalYearContaining(first.date, startMonth) : null;
}

interface ClosingGroup {
  accountId: string;
  type: "revenue" | "expense";
  branchId: string | null;
  costCenterId: string | null;
  departmentId: string | null;
  department: string | null;
  net: number; // سنتات، مدين − دائن
}

async function computeClosing(db: Db, tenantId: string, companyId: string, year: FiscalYearBounds) {
  const lines = await db.journalEntryLine.findMany({
    where: {
      account: { tenantId, companyId, type: { in: ["revenue", "expense"] } },
      journalEntry: { AND: [COUNTED_ENTRY_WHERE], tenantId, companyId, date: { lte: year.endInclusive } },
    },
    select: { accountId: true, branchId: true, costCenterId: true, departmentId: true, department: true, debit: true, credit: true, account: { select: { type: true } } },
  });
  const groups = new Map<string, ClosingGroup>();
  for (const line of lines) {
    const key = [line.accountId, line.branchId, line.costCenterId, line.departmentId, line.department].join("|");
    let group = groups.get(key);
    if (!group) {
      group = { accountId: line.accountId, type: line.account.type as "revenue" | "expense", branchId: line.branchId, costCenterId: line.costCenterId, departmentId: line.departmentId, department: line.department, net: 0 };
      groups.set(key, group);
    }
    group.net += cents(line.debit) - cents(line.credit);
  }
  const balances = [...groups.values()].filter((g) => g.net !== 0);
  const totalRevenue = balances.filter((g) => g.type === "revenue").reduce((s, g) => s - g.net, 0);
  const totalExpense = balances.filter((g) => g.type === "expense").reduce((s, g) => s + g.net, 0);
  const draftCount = await db.journalEntry.count({ where: { tenantId, companyId, status: "saved", date: { gte: year.start, lte: year.endInclusive } } });
  return { balances, totalRevenue, totalExpense, netIncome: totalRevenue - totalExpense, draftCount };
}

async function assertCloseAccount(db: Db, tenantId: string, companyId: string, accountId: string | null | undefined) {
  if (!accountId) throw badRequest(FISCAL_CLOSE_ACCOUNT_REQUIRED);
  const account = await db.account.findFirst({ where: { id: accountId, tenantId, companyId, type: "equity", isPosting: true, isActive: true, isArchived: false } });
  if (!account) throw badRequest(FISCAL_CLOSE_ACCOUNT_INVALID);
  return account;
}

const yearDto = (year: FiscalYearBounds) => ({ start: fmtDateOnly(year.start), end: fmtDateOnly(year.end), label: year.label });

export async function getFiscalYearOverview(tenantId: string, companyId: string, now = new Date()) {
  const company = await loadCompany(prisma, tenantId, companyId);
  const startMonth = normalizeStartMonth(company.fiscalYearStartMonth);
  const today = todayRiyadh(now);
  const [closings, closeAccounts, next] = await Promise.all([
    prisma.fiscalYearClosing.findMany({ where: { companyId }, orderBy: { yearEnd: "desc" } }),
    prisma.account.findMany({ where: { tenantId, companyId, type: "equity", isPosting: true, isActive: true, isArchived: false }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, nameEn: true } }),
    nextYearToClose(prisma, tenantId, companyId, startMonth),
  ]);
  const entries = await prisma.journalEntry.findMany({ where: { id: { in: closings.map((c) => c.journalEntryId).filter((id): id is string => !!id) } }, select: { id: true, entryNumber: true } });
  const entryNumbers = new Map(entries.map((e) => [e.id, e.entryNumber]));
  const suggested = closeAccounts.find((a) => a.code === "331002") || closeAccounts.find((a) => /العام الحالي/.test(a.name)) || null;

  let nextClosing = null;
  if (next) {
    const preview = await computeClosing(prisma, tenantId, companyId, next);
    const blockers: ("not_ended" | "drafts")[] = [];
    if (today.getTime() <= next.end.getTime()) blockers.push("not_ended");
    if (preview.draftCount > 0) blockers.push("drafts");
    nextClosing = {
      year: yearDto(next),
      totalRevenue: fromCents(preview.totalRevenue),
      totalExpense: fromCents(preview.totalExpense),
      netIncome: fromCents(preview.netIncome),
      accountLines: preview.balances.length,
      draftCount: preview.draftCount,
      blockers,
    };
  }

  return {
    fiscalYearStartMonth: startMonth,
    fiscalCloseAccountId: company.fiscalCloseAccountId,
    suggestedCloseAccountId: suggested?.id ?? null,
    fiscalYearClosingDate: company.fiscalYearClosingDate ? fmtDateOnly(company.fiscalYearClosingDate) : null,
    currentYear: yearDto(fiscalYearContaining(today, startMonth)),
    closeAccounts,
    nextClosing,
    closings: closings.map((c) => ({
      id: c.id,
      year: { start: fmtDateOnly(c.yearStart), end: fmtDateOnly(c.yearEnd), label: fiscalYearContaining(c.yearStart, startMonth).label },
      journalEntryId: c.journalEntryId,
      entryNumber: c.journalEntryId ? entryNumbers.get(c.journalEntryId) ?? null : null,
      totalRevenue: Number(c.totalRevenue),
      totalExpense: Number(c.totalExpense),
      netIncome: Number(c.netIncome),
      closeAccountId: c.closeAccountId,
      closedAt: c.createdAt,
    })),
  };
}

export async function updateFiscalYearSettings(tenantId: string, companyId: string, input: { fiscalYearStartMonth?: number; fiscalCloseAccountId?: string | null }) {
  const company = await loadCompany(prisma, tenantId, companyId);
  const data: Prisma.CompanyUncheckedUpdateInput = {};
  if (input.fiscalYearStartMonth !== undefined) {
    if (!Number.isInteger(input.fiscalYearStartMonth) || input.fiscalYearStartMonth < 1 || input.fiscalYearStartMonth > 12) throw badRequest(FISCAL_START_MONTH_INVALID);
    if (input.fiscalYearStartMonth !== company.fiscalYearStartMonth && (await lastClosing(prisma, companyId))) throw badRequest(FISCAL_START_MONTH_LOCKED);
    data.fiscalYearStartMonth = input.fiscalYearStartMonth;
  }
  if (input.fiscalCloseAccountId !== undefined) {
    if (input.fiscalCloseAccountId) await assertCloseAccount(prisma, tenantId, companyId, input.fiscalCloseAccountId);
    data.fiscalCloseAccountId = input.fiscalCloseAccountId || null;
  }
  await prisma.company.update({ where: { id: company.id }, data });
  return getFiscalYearOverview(tenantId, companyId);
}

export async function closeFiscalYear(
  tenantId: string,
  companyId: string,
  userId: string,
  input: { yearEnd: string; closeAccountId?: string | null },
  now = new Date(),
) {
  await prisma.$transaction(async (tx) => {
    // يقفل صف الشركة طوال المعاملة: لا قيد جديد ولا إقفال متزامن بين الحساب والكتابة.
    const previousClosingDate = await lockCompanyClosingDate(tx, companyId);
    const company = await loadCompany(tx, tenantId, companyId);
    const startMonth = normalizeStartMonth(company.fiscalYearStartMonth);
    const year = await nextYearToClose(tx, tenantId, companyId, startMonth);
    if (!year) throw badRequest(FISCAL_NOTHING_TO_CLOSE);
    if (fmtDateOnly(year.end) !== input.yearEnd) throw badRequest(FISCAL_YEAR_STALE);
    if (todayRiyadh(now).getTime() <= year.end.getTime()) throw badRequest(FISCAL_YEAR_NOT_ENDED);
    const closeAccount = await assertCloseAccount(tx, tenantId, companyId, input.closeAccountId || company.fiscalCloseAccountId);
    const result = await computeClosing(tx, tenantId, companyId, year);
    if (result.draftCount > 0) throw badRequest(FISCAL_YEAR_HAS_DRAFTS);

    const closing = await tx.fiscalYearClosing.create({
      data: {
        tenantId, companyId, yearStart: year.start, yearEnd: year.end, closeAccountId: closeAccount.id,
        totalRevenue: new Prisma.Decimal(fromCents(result.totalRevenue)),
        totalExpense: new Prisma.Decimal(fromCents(result.totalExpense)),
        netIncome: new Prisma.Decimal(fromCents(result.netIncome)),
        previousClosingDate, closedBy: userId,
      },
    });

    if (result.balances.length) {
      const byBranch = new Map<string | null, number>();
      for (const g of result.balances) byBranch.set(g.branchId, (byBranch.get(g.branchId) || 0) + g.net);
      const memo = `قيد إقفال السنة المالية ${year.label} (${fmtDateOnly(year.start)} — ${fmtDateOnly(year.end)})`;
      // قيد نظامي داخل فترة قد تكون مقفلة يدوياً من قبل — لذلك يُسمح بتاريخه هنا وحده.
      const { entryNumber, entrySeq } = await reserveEntryNumber(tx, tenantId, companyId, year.end, { allowClosedPeriod: true });
      const entry = await tx.journalEntry.create({
        data: {
          tenantId, companyId, date: year.end, memo, status: "posted", entryNumber, entrySeq,
          sourceModule: "fiscal_year_closing", sourceId: closing.id, createdBy: userId,
          lines: {
            create: [
              ...result.balances.map((g) => ({
                accountId: g.accountId, branchId: g.branchId, costCenterId: g.costCenterId, departmentId: g.departmentId, department: g.department,
                description: "إقفال",
                debit: new Prisma.Decimal(g.net < 0 ? fromCents(-g.net) : 0),
                credit: new Prisma.Decimal(g.net > 0 ? fromCents(g.net) : 0),
              })),
              ...[...byBranch].filter(([, net]) => net !== 0).map(([branchId, net]) => ({
                accountId: closeAccount.id, branchId,
                description: net < 0 ? "صافي ربح السنة" : "صافي خسارة السنة",
                debit: new Prisma.Decimal(net > 0 ? fromCents(net) : 0),
                credit: new Prisma.Decimal(net < 0 ? fromCents(-net) : 0),
              })),
            ],
          },
        },
      });
      await recomputeEntryTotal(tx, entry.id);
      await tx.fiscalYearClosing.update({ where: { id: closing.id }, data: { journalEntryId: entry.id } });
    }

    const lockTo = previousClosingDate && previousClosingDate.getTime() > year.end.getTime() ? previousClosingDate : year.end;
    await tx.company.update({ where: { id: companyId }, data: { fiscalYearClosingDate: lockTo, fiscalCloseAccountId: closeAccount.id } });
    await tx.auditLog.create({
      data: {
        tenantId, userId, action: "company.fiscal_year_close", entityType: "Company", entityId: companyId,
        metadata: { yearStart: fmtDateOnly(year.start), yearEnd: fmtDateOnly(year.end), closingId: closing.id, netIncome: fromCents(result.netIncome), oldClosingDate: previousClosingDate, newClosingDate: lockTo },
      },
    });
  }, { timeout: 60_000 });
  return getFiscalYearOverview(tenantId, companyId, now);
}

export async function reopenLastFiscalYear(tenantId: string, companyId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    const currentClosingDate = await lockCompanyClosingDate(tx, companyId);
    await loadCompany(tx, tenantId, companyId);
    const last = await lastClosing(tx, companyId);
    if (!last) throw badRequest(FISCAL_NO_CLOSED_YEAR);
    await tx.company.update({ where: { id: companyId }, data: { fiscalYearClosingDate: last.previousClosingDate } });
    if (last.journalEntryId) await tx.journalEntry.deleteMany({ where: { id: last.journalEntryId, tenantId, companyId, sourceModule: "fiscal_year_closing" } });
    await tx.fiscalYearClosing.delete({ where: { id: last.id } });
    await tx.auditLog.create({
      data: {
        tenantId, userId, action: "company.fiscal_year_reopen", entityType: "Company", entityId: companyId,
        metadata: { yearStart: fmtDateOnly(last.yearStart), yearEnd: fmtDateOnly(last.yearEnd), deletedEntryId: last.journalEntryId, netIncome: Number(last.netIncome), oldClosingDate: currentClosingDate, newClosingDate: last.previousClosingDate },
      },
    });
  });
  return getFiscalYearOverview(tenantId, companyId);
}

/** أقدم تاريخ قفل مسموح لفتح الإقفال اليدوي: نهاية آخر سنة مقفلة (ما قبلها يُفتح بإعادة فتح السنة). */
export async function lastClosedYearEnd(companyId: string): Promise<Date | null> {
  return (await lastClosing(prisma, companyId))?.yearEnd ?? null;
}
