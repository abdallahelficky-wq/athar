import { prisma } from "../../lib/prisma";
import type { Account } from "@prisma/client";
import { notFound } from "../../lib/httpError";

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

/**
 * كشف حساب (سجل معاملات + رصيد متحرك) لعميل أو مورد — يقتصر على أسطر القيود المرحّلة
 * المرتبطة بـ customerId/supplierId **وعلى حساب الذمم نفسه فقط** ("ذمم مدينة" للعميل،
 * "ذمم دائنة - موردين" للمورد)، تماماً كمنطق getCustomerBalance/getSupplierBalance
 * الموجود مسبقاً في customers.controller.ts/suppliers.controller.ts — بقية أسطر نفس القيد
 * (حساب الإيراد/المصروف، الضريبة) موسومة بنفس customerId/supplierId أيضاً لأغراض تقارير
 * أخرى، لكنها ليست جزءاً من حركة حساب الذمم وستُكرّر المبلغ لو أُدرجت هنا.
 * إشارة الرصيد: للعميل نبدأ من صفر ونزيد (مدين - دائن) لأن حساب "ذمم مدينة" مدين الطبيعة
 * (رصيد موجب = العميل مدين لنا)؛ للمورد العكس (دائن - مدين، رصيد موجب = نحن مدينون له).
 */
async function buildPartyStatement(
  tenantId: string,
  filter: { customerId?: string; supplierId?: string },
  ledgerAccountName: string,
  companyId: string | undefined,
  dateFrom: Date | undefined,
  dateTo: Date | undefined,
  sign: 1 | -1,
) {
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      ...filter,
      account: { name: ledgerAccountName },
      journalEntry: {
        tenantId,
        status: "posted",
        companyId: companyId || undefined,
        date: { gte: dateFrom, lte: dateTo },
      },
    },
    include: { journalEntry: { include: { company: true } }, account: true },
    orderBy: { journalEntry: { date: "asc" } },
  });

  let balance = 0;
  const rows = lines.map((l) => {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    balance += sign === 1 ? debit - credit : credit - debit;
    return {
      date: l.journalEntry.date,
      memo: l.journalEntry.memo,
      accountName: l.account.name,
      journalEntryId: l.journalEntryId,
      debit,
      credit,
      balance,
    };
  });

  return { rows, closingBalance: balance };
}

export async function getCustomerStatement(
  tenantId: string,
  customerId: string,
  companyId?: string,
  dateFrom?: Date,
  dateTo?: Date,
) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) throw notFound("العميل غير موجود");
  const statement = await buildPartyStatement(tenantId, { customerId }, "ذمم مدينة", companyId, dateFrom, dateTo, 1);
  return { customer, ...statement };
}

export async function getSupplierStatement(
  tenantId: string,
  supplierId: string,
  companyId?: string,
  dateFrom?: Date,
  dateTo?: Date,
) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId } });
  if (!supplier) throw notFound("المورد غير موجود");
  const statement = await buildPartyStatement(
    tenantId,
    { supplierId },
    "ذمم دائنة - موردين",
    companyId,
    dateFrom,
    dateTo,
    -1,
  );
  return { supplier, ...statement };
}
