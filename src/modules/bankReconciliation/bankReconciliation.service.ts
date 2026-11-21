import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";
import { toHalalas } from "../../lib/money";

/**
 * التسوية البنكية — كشف حساب البنك (مرفوع من Excel/CSV في الواجهة، تصل أسطره هنا JSON) يُطابَق سطراً سطراً مع
 * حركة حساب البنك في الدفاتر: أسطر القيود **المرحَّلة** على حساب البنك نفسه في الشركة نفسها.
 *
 * الإشارة: سطر الكشف موجب = إيداع، سالب = سحب. سطر القيد: مدين حساب البنك − دائنه. المطابقة بالمبلغ الموقَّع
 * بالهللة (toHalalas) لا بالفاصلة العائمة.
 *
 * المطابقة التلقائية محافظة عمداً: تُطابِق فقط حين يوجد مرشّح واحد بأقرب تاريخ ضمن ±AUTO_MATCH_DAYS أيام؛ أي التباس
 * (مرشّحان بنفس المبلغ ونفس البُعد) يُترَك للمطابقة اليدوية بدل تخمين قد يُخفي خطأً.
 *
 * ملخص التسوية (المعادلة الكلاسيكية):
 *   رصيد الدفاتر في نهاية الفترة − حركات دفاتر غير مطابَقة في الفترة (لم تظهر في البنك بعد)
 *   + حركات كشف غير مطابَقة (لم تُسجَّل في الدفاتر بعد: عمولات، فوائد…) = الرصيد الختامي للكشف المحسوب
 *   الفرق = رصيد الكشف الختامي المُدخَل − المحسوب. التسوية (reconcile) تتطلب فرقاً صفراً وكل أسطر الكشف مطابَقة.
 */
export const AUTO_MATCH_DAYS = 5;
const DAY_MS = 86_400_000;

type Tx = Prisma.TransactionClient;

export interface StatementLineInput {
  date: string;
  description?: string | null;
  reference?: string | null;
  amount: number;
}

export interface CreateStatementInput {
  companyId: string;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  fileName?: string | null;
  lines: StatementLineInput[];
}

const dayOf = (d: string) => new Date(`${d}T00:00:00.000Z`);
const endOfDay = (d: Date) => new Date(d.getTime() + DAY_MS - 1);
const halalas = (v: Prisma.Decimal | number | string) => toHalalas(Number(v));
const bookAmount = (line: { debit: Prisma.Decimal | number; credit: Prisma.Decimal | number }) => halalas(line.debit) - halalas(line.credit);

async function assertBankAccount(tenantId: string, companyId: string, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, tenantId, companyId },
    select: { id: true, isBankOrCash: true, isPosting: true, name: true, code: true },
  });
  if (!account) throw notFound("الحساب غير موجود");
  if (!account.isBankOrCash) throw badRequest("التسوية البنكية لحسابات البنوك والصناديق فقط");
  return account;
}

async function loadStatement(tenantId: string, id: string, tx: Tx | typeof prisma = prisma) {
  const statement = await tx.bankStatement.findFirst({ where: { id, tenantId } });
  if (!statement) throw notFound("كشف البنك غير موجود");
  return statement;
}

function assertOpen(statement: { status: string }) {
  if (statement.status === "reconciled") throw conflict("هذا الكشف مُسوّى — أعد فتحه أولاً لتعديل المطابقات");
}

export async function listStatements(tenantId: string, companyId: string, accountId?: string) {
  const rows = await prisma.bankStatement.findMany({
    where: { tenantId, companyId, ...(accountId ? { accountId } : {}) },
    orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    include: { account: { select: { id: true, code: true, name: true } }, _count: { select: { lines: true } } },
  });
  const unmatched = await prisma.bankStatementLine.groupBy({
    by: ["statementId"],
    where: { tenantId, companyId, statementId: { in: rows.map((r) => r.id) }, journalEntryLineId: null },
    _count: { _all: true },
  });
  const unmatchedBy = new Map(unmatched.map((u) => [u.statementId, u._count._all]));
  return rows.map(({ _count, ...r }) => ({ ...r, lineCount: _count.lines, unmatchedCount: unmatchedBy.get(r.id) ?? 0 }));
}

export async function createStatement(tenantId: string, userId: string, input: CreateStatementInput) {
  await assertBankAccount(tenantId, input.companyId, input.accountId);
  const periodStart = dayOf(input.periodStart);
  const periodEnd = dayOf(input.periodEnd);
  if (periodEnd < periodStart) throw badRequest("نهاية فترة الكشف قبل بدايتها");
  if (input.lines.length === 0) throw badRequest("الكشف بلا أسطر");
  for (const [i, line] of input.lines.entries()) {
    const d = dayOf(line.date);
    if (Number.isNaN(d.getTime())) throw badRequest(`تاريخ غير صالح في السطر ${i + 1}`);
    if (d < periodStart || d > periodEnd) throw badRequest(`تاريخ السطر ${i + 1} (${line.date}) خارج فترة الكشف`);
    if (toHalalas(line.amount) === 0) throw badRequest(`مبلغ السطر ${i + 1} صفر`);
  }
  // اتساق الكشف نفسه: الافتتاحي + مجموع الحركات = الختامي (خطأ في الأعمدة المختارة يظهر هنا لا لاحقاً)
  const movement = input.lines.reduce((s, l) => s + toHalalas(l.amount), 0);
  if (toHalalas(input.openingBalance) + movement !== toHalalas(input.closingBalance)) {
    throw badRequest(
      `الرصيد الافتتاحي + مجموع الحركات (${((toHalalas(input.openingBalance) + movement) / 100).toFixed(2)}) لا يساوي الرصيد الختامي (${Number(input.closingBalance).toFixed(2)}) — راجع أعمدة المدين/الدائن المختارة`,
    );
  }

  const statement = await prisma.$transaction(async (tx) => {
    const created = await tx.bankStatement.create({
      data: {
        tenantId,
        companyId: input.companyId,
        accountId: input.accountId,
        periodStart,
        periodEnd,
        openingBalance: input.openingBalance,
        closingBalance: input.closingBalance,
        fileName: input.fileName ?? null,
        createdById: userId,
      },
    });
    await tx.bankStatementLine.createMany({
      data: input.lines.map((l, i) => ({
        statementId: created.id,
        tenantId,
        companyId: input.companyId,
        lineNo: i + 1,
        date: dayOf(l.date),
        description: l.description?.trim() || null,
        reference: l.reference?.trim() || null,
        amount: l.amount,
      })),
    });
    return created;
  });
  await autoMatch(tenantId, userId, statement.id);
  return getStatement(tenantId, statement.id);
}

/** أسطر القيود المرحَّلة على حساب البنك غير المطابَقة بعد، ضمن نطاق تاريخ */
async function unmatchedBookLines(tx: Tx | typeof prisma, tenantId: string, companyId: string, accountId: string, from: Date, to: Date) {
  return tx.journalEntryLine.findMany({
    where: {
      accountId,
      bankStatementLine: { is: null },
      journalEntry: { tenantId, companyId, status: "posted", date: { gte: from, lte: endOfDay(to) } },
    },
    select: {
      id: true,
      debit: true,
      credit: true,
      description: true,
      journalEntry: { select: { id: true, entryNumber: true, date: true, memo: true, sourceModule: true } },
    },
    orderBy: [{ journalEntry: { date: "asc" } }, { id: "asc" }],
  });
}

export async function autoMatch(tenantId: string, userId: string, statementId: string) {
  return prisma.$transaction(async (tx) => {
    const statement = await loadStatement(tenantId, statementId, tx);
    assertOpen(statement);
    const lines = await tx.bankStatementLine.findMany({
      where: { statementId, journalEntryLineId: null },
      orderBy: [{ date: "asc" }, { lineNo: "asc" }],
    });
    if (lines.length === 0) return { matched: 0 };
    const from = new Date(statement.periodStart.getTime() - AUTO_MATCH_DAYS * DAY_MS);
    const to = new Date(statement.periodEnd.getTime() + AUTO_MATCH_DAYS * DAY_MS);
    const book = await unmatchedBookLines(tx, tenantId, statement.companyId, statement.accountId, from, to);
    const used = new Set<string>();
    let matched = 0;
    const now = new Date();
    for (const line of lines) {
      const amount = halalas(line.amount);
      let best: string[] = [];
      let bestDistance = Infinity;
      for (const b of book) {
        if (used.has(b.id) || bookAmount(b) !== amount) continue;
        const distance = Math.abs(Math.round((b.journalEntry.date.getTime() - line.date.getTime()) / DAY_MS));
        if (distance > AUTO_MATCH_DAYS) continue;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = [b.id];
        } else if (distance === bestDistance) {
          best.push(b.id);
        }
      }
      if (best.length !== 1) continue;
      used.add(best[0]);
      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: { journalEntryLineId: best[0], matchType: "auto", matchedAt: now, matchedById: userId },
      });
      matched += 1;
    }
    return { matched };
  });
}

export async function matchLine(tenantId: string, userId: string, statementId: string, lineId: string, journalEntryLineId: string) {
  return prisma.$transaction(async (tx) => {
    const statement = await loadStatement(tenantId, statementId, tx);
    assertOpen(statement);
    const line = await tx.bankStatementLine.findFirst({ where: { id: lineId, statementId } });
    if (!line) throw notFound("سطر الكشف غير موجود");
    if (line.journalEntryLineId) throw conflict("سطر الكشف مطابَق بالفعل — افكّ مطابقته أولاً");
    const book = await tx.journalEntryLine.findFirst({
      where: {
        id: journalEntryLineId,
        accountId: statement.accountId,
        journalEntry: { tenantId, companyId: statement.companyId, status: "posted" },
      },
      select: { id: true, debit: true, credit: true, bankStatementLine: { select: { id: true } } },
    });
    if (!book) throw notFound("سطر القيد غير موجود على حساب هذا البنك أو غير مرحَّل");
    if (book.bankStatementLine) throw conflict("سطر القيد مطابَق بالفعل مع سطر كشف آخر");
    if (bookAmount(book) !== halalas(line.amount)) throw badRequest("مبلغ سطر القيد لا يساوي مبلغ سطر الكشف");
    return tx.bankStatementLine.update({
      where: { id: line.id },
      data: { journalEntryLineId: book.id, matchType: "manual", matchedAt: new Date(), matchedById: userId },
    });
  });
}

export async function unmatchLine(tenantId: string, statementId: string, lineId: string) {
  return prisma.$transaction(async (tx) => {
    const statement = await loadStatement(tenantId, statementId, tx);
    assertOpen(statement);
    const line = await tx.bankStatementLine.findFirst({ where: { id: lineId, statementId } });
    if (!line) throw notFound("سطر الكشف غير موجود");
    return tx.bankStatementLine.update({
      where: { id: line.id },
      data: { journalEntryLineId: null, matchType: null, matchedAt: null, matchedById: null },
    });
  });
}

export async function getStatement(tenantId: string, id: string) {
  const statement = await prisma.bankStatement.findFirst({
    where: { id, tenantId },
    include: { account: { select: { id: true, code: true, name: true } } },
  });
  if (!statement) throw notFound("كشف البنك غير موجود");
  const lines = await prisma.bankStatementLine.findMany({
    where: { statementId: id },
    orderBy: [{ date: "asc" }, { lineNo: "asc" }],
    include: {
      journalEntryLine: {
        select: { id: true, debit: true, credit: true, description: true, journalEntry: { select: { id: true, entryNumber: true, date: true, memo: true } } },
      },
    },
  });
  const outstanding = await unmatchedBookLines(prisma, tenantId, statement.companyId, statement.accountId, statement.periodStart, statement.periodEnd);
  const bookBalanceRows = await prisma.journalEntryLine.aggregate({
    where: { accountId: statement.accountId, journalEntry: { tenantId, companyId: statement.companyId, status: "posted", date: { lte: endOfDay(statement.periodEnd) } } },
    _sum: { debit: true, credit: true },
  });
  const bookBalance = halalas(bookBalanceRows._sum.debit ?? 0) - halalas(bookBalanceRows._sum.credit ?? 0);
  const unmatchedBook = outstanding.reduce((s, b) => s + bookAmount(b), 0);
  const unmatchedBank = lines.filter((l) => !l.journalEntryLineId).reduce((s, l) => s + halalas(l.amount), 0);
  const computedClosing = bookBalance - unmatchedBook + unmatchedBank;
  const difference = halalas(statement.closingBalance) - computedClosing;
  const money = (h: number) => h / 100;
  return {
    ...statement,
    lines,
    outstandingBookLines: outstanding.map((b) => ({ ...b, amount: money(bookAmount(b)) })),
    summary: {
      bookBalance: money(bookBalance),
      unmatchedBookTotal: money(unmatchedBook),
      unmatchedBankTotal: money(unmatchedBank),
      computedClosingBalance: money(computedClosing),
      statementClosingBalance: Number(statement.closingBalance),
      difference: money(difference),
      unmatchedBankCount: lines.filter((l) => !l.journalEntryLineId).length,
      unmatchedBookCount: outstanding.length,
      canReconcile: difference === 0 && lines.every((l) => l.journalEntryLineId),
    },
  };
}

export async function reconcileStatement(tenantId: string, userId: string, id: string) {
  const current = await getStatement(tenantId, id);
  assertOpen(current);
  if (current.summary.unmatchedBankCount > 0) {
    throw badRequest("لا يمكن التسوية وفي الكشف أسطر غير مطابَقة — سجّل قيودها (عمولات، فوائد…) ثم طابِقها");
  }
  if (current.summary.difference !== 0) {
    throw badRequest(`لا يمكن التسوية والفرق ليس صفراً (${current.summary.difference.toFixed(2)})`);
  }
  return prisma.bankStatement.update({ where: { id }, data: { status: "reconciled", reconciledAt: new Date(), reconciledById: userId } });
}

export async function reopenStatement(tenantId: string, id: string) {
  const statement = await loadStatement(tenantId, id);
  if (statement.status !== "reconciled") throw badRequest("الكشف مفتوح بالفعل");
  return prisma.bankStatement.update({ where: { id }, data: { status: "open", reconciledAt: null, reconciledById: null } });
}

export async function deleteStatement(tenantId: string, id: string) {
  const statement = await loadStatement(tenantId, id);
  assertOpen(statement);
  await prisma.bankStatement.delete({ where: { id } });
}

/**
 * يُستدعى من نقاط حذف/فك ترحيل القيود (journalPosting.deleteJournalEntryTx ومسارات القيود اليدوية) قبل الحذف:
 * قيد له سطر مطابَق في كشف مُسوّى لا يُحذف — رسالة واضحة بدل خطأ قاعدة البيانات من bank_reconciled_line_guard.
 */
export async function assertNotBankReconciled(tx: Tx | typeof prisma, journalEntryId: string, action: string) {
  const hit = await tx.bankStatementLine.findFirst({
    where: { journalEntryLine: { journalEntryId }, statement: { status: "reconciled" } },
    select: { statement: { select: { periodStart: true, periodEnd: true } } },
  });
  if (hit) {
    throw badRequest(
      `لا يمكن ${action} لأن القيد مطابَق في تسوية بنكية مُسوّاة (كشف ${hit.statement.periodStart.toISOString().slice(0, 10)} — ${hit.statement.periodEnd.toISOString().slice(0, 10)}). أعد فتح الكشف أولاً من شاشة التسوية البنكية.`,
    );
  }
}

/**
 * قيد يخرج من حالة «مرحَّل» (فك ترحيل قيد يدوي أو مرآته، أو حذف قيد مستند عند فك ترحيله): في كشف مُسوّى ⇒ رفض
 * (assertNotBankReconciled)؛ في كشف مفتوح ⇒ تُفَكّ مطابقة أسطره فيعود سطر الكشف «غير مطابَق» بدل أن يبقى مطابَقاً
 * مع قيد لم يعد في الدفاتر المرحَّلة.
 */
export async function releaseBankMatchesTx(tx: Tx | typeof prisma, journalEntryId: string, action: string) {
  await assertNotBankReconciled(tx, journalEntryId, action);
  await tx.bankStatementLine.updateMany({
    where: { journalEntryLine: { journalEntryId } },
    data: { journalEntryLineId: null, matchType: null, matchedAt: null, matchedById: null },
  });
}
