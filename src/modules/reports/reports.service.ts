import { prisma } from "../../lib/prisma";
import type { Account } from "@prisma/client";

interface DateRange {
  companyId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

interface AccountBalance {
  account: Account;
  debit: number;
  credit: number;
}

/**
 * تجميع أرصدة الحسابات من أسطر القيود المرحّلة فقط (posted) — مطابق تماماً لمنطق
 * aggregateAccounts في AtharAlMuhasabi.jsx، مع إضافة تصفية بالتاريخ والشركة كما
 * تتطلبها توقيعات endpoints في القسم 5 من المستند. كل التقارير تُحسب من هذه الدالة
 * فقط ولا تُخزَّن أرقامها في مكان منفصل (مبدأ القسم 3).
 */
async function aggregateAccountBalances(tenantId: string, range: DateRange): Promise<Map<string, AccountBalance>> {
  const accounts = await prisma.account.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  const map = new Map<string, AccountBalance>();
  accounts.forEach((a) => map.set(a.id, { account: a, debit: 0, credit: 0 }));

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      journalEntry: {
        tenantId,
        status: "posted",
        companyId: range.companyId || undefined,
        date: {
          gte: range.dateFrom,
          lte: range.dateTo,
        },
      },
    },
    select: { accountId: true, debit: true, credit: true },
  });

  for (const line of lines) {
    const entry = map.get(line.accountId);
    if (!entry) continue;
    entry.debit += Number(line.debit);
    entry.credit += Number(line.credit);
  }

  return map;
}

export async function getTrialBalance(tenantId: string, companyId?: string, asOfDate?: Date) {
  const balances = await aggregateAccountBalances(tenantId, { companyId, dateTo: asOfDate });

  const rows = [...balances.values()].map(({ account, debit, credit }) => ({
    accountId: account.id,
    name: account.name,
    type: account.type,
    debit,
    credit,
    net: debit - credit,
  }));

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  return {
    rows,
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}

async function computeIncomeStatement(tenantId: string, companyId: string | undefined, dateFrom?: Date, dateTo?: Date) {
  const balances = await aggregateAccountBalances(tenantId, { companyId, dateFrom, dateTo });

  const revenueRows = [...balances.values()]
    .filter((b) => b.account.type === "revenue")
    .map((b) => ({ accountId: b.account.id, name: b.account.name, amount: b.credit - b.debit }));

  const expenseRows = [...balances.values()]
    .filter((b) => b.account.type === "expense")
    .map((b) => ({ accountId: b.account.id, name: b.account.name, amount: b.debit - b.credit }));

  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0);
  const netIncome = totalRevenue - totalExpense;

  return { revenueRows, expenseRows, totalRevenue, totalExpense, netIncome };
}

export async function getIncomeStatement(tenantId: string, companyId?: string, dateFrom?: Date, dateTo?: Date) {
  return computeIncomeStatement(tenantId, companyId, dateFrom, dateTo);
}

export async function getBalanceSheet(tenantId: string, companyId?: string, asOfDate?: Date) {
  const balances = await aggregateAccountBalances(tenantId, { companyId, dateTo: asOfDate });

  // صافي الربح التراكمي حتى تاريخ التقرير يُضاف لحقوق الملكية (أرباح مرحّلة) —
  // نفس منطق BalanceSheetReport في الواجهة المرجعية
  const { netIncome } = await computeIncomeStatement(tenantId, companyId, undefined, asOfDate);

  const assetRows = [...balances.values()]
    .filter((b) => b.account.type === "asset")
    .map((b) => ({ accountId: b.account.id, name: b.account.name, amount: b.debit - b.credit }));

  const liabilityRows = [...balances.values()]
    .filter((b) => b.account.type === "liability")
    .map((b) => ({ accountId: b.account.id, name: b.account.name, amount: b.credit - b.debit }));

  const equityRows = [...balances.values()]
    .filter((b) => b.account.type === "equity")
    .map((b) => ({ accountId: b.account.id, name: b.account.name, amount: b.credit - b.debit }));

  const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquityBase = equityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquity = totalEquityBase + netIncome;

  return {
    assetRows,
    liabilityRows,
    equityRows,
    netIncome,
    totalAssets,
    totalLiabilities,
    totalEquityBase,
    totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1,
  };
}
