import { prisma } from "../../lib/prisma";
import { aggregateAccountBalances, getBalanceSheet, getIncomeStatement } from "../reports/reports.service";
import { getSalesMonthlyTrend, getSalesByCustomer, getReceivablesAging, invoicesWithPaid } from "../salesReports/salesReports.service";
import { getPayablesAging } from "../purchaseReports/purchaseReports.service";
import { calcEOS, accruedLeaveDays, PAYROLL_JOURNAL_MAP } from "../../lib/hrCalculations";

export interface PeriodRange {
  dateFrom: Date;
  dateTo: Date;
}

function previousPeriod(range: PeriodRange): PeriodRange {
  const lengthMs = range.dateTo.getTime() - range.dateFrom.getTime();
  return {
    dateFrom: new Date(range.dateFrom.getTime() - lengthMs - 86_400_000),
    dateTo: new Date(range.dateFrom.getTime() - 86_400_000),
  };
}

function daysBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function endOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0, 23, 59, 59);
}

/** آخر N شهر بصيغة YYYY-MM بترتيب تصاعدي، ينتهي بالشهر الحالي */
function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

async function netSalesForRange(tenantId: string, companyId: string | undefined, dateFrom: Date, dateTo: Date) {
  const [invoices, returns] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: { tenantId, companyId: companyId || undefined, status: "posted", date: { gte: dateFrom, lte: dateTo } },
      _sum: { grandTotal: true },
    }),
    prisma.salesReturn.aggregate({
      where: { tenantId, companyId: companyId || undefined, status: "posted", date: { gte: dateFrom, lte: dateTo } },
      _sum: { grandTotal: true },
    }),
  ]);
  return Number(invoices._sum.grandTotal || 0) - Number(returns._sum.grandTotal || 0);
}

async function getCashAccountBalances(tenantId: string, companyId?: string) {
  const balances = await aggregateAccountBalances(tenantId, { companyId, dateTo: new Date() });
  return [...balances.values()].filter((b) => b.account.isBankOrCash);
}

async function getCashTotal(tenantId: string, companyId?: string) {
  const rows = await getCashAccountBalances(tenantId, companyId);
  return rows.reduce((s, b) => s + (b.debit - b.credit), 0);
}

export async function getFinancialKpis(tenantId: string, companyId: string | undefined, range: PeriodRange) {
  const prev = previousPeriod(range);
  const [salesCurrent, salesPrev, incomeStatement, cashBalance, receivables, payables] = await Promise.all([
    netSalesForRange(tenantId, companyId, range.dateFrom, range.dateTo),
    netSalesForRange(tenantId, companyId, prev.dateFrom, prev.dateTo),
    getIncomeStatement(tenantId, companyId, range.dateFrom, range.dateTo),
    getCashTotal(tenantId, companyId),
    getReceivablesAging(tenantId, { companyId }),
    getPayablesAging(tenantId, { companyId }),
  ]);

  const salesChangePct = salesPrev > 0 ? ((salesCurrent - salesPrev) / salesPrev) * 100 : salesCurrent > 0 ? 100 : 0;

  return {
    salesCurrent,
    salesPrev,
    salesChangePct,
    netProfitEstimate: incomeStatement.netIncome,
    cashBalance,
    receivablesTotal: receivables.reduce((s, r) => s + r.total, 0),
    payablesTotal: payables.reduce((s, r) => s + r.total, 0),
  };
}

export async function getCashBreakdown(tenantId: string, companyId?: string) {
  const rows = await getCashAccountBalances(tenantId, companyId);
  return rows.map((b) => ({ accountId: b.account.id, name: b.account.name, balance: b.debit - b.credit }));
}

export async function getCashFlowMonthly(tenantId: string, companyId?: string, months = 12) {
  const monthsList = lastNMonths(months);
  const dateFrom = new Date(`${monthsList[0]}-01T00:00:00.000Z`);
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      account: { tenantId, isBankOrCash: true },
      journalEntry: { tenantId, status: "posted", companyId: companyId || undefined, date: { gte: dateFrom } },
    },
    select: { debit: true, credit: true, journalEntry: { select: { date: true } } },
  });

  const byMonth = new Map<string, { cashIn: number; cashOut: number }>();
  monthsList.forEach((m) => byMonth.set(m, { cashIn: 0, cashOut: 0 }));
  lines.forEach((l) => {
    const month = l.journalEntry.date.toISOString().slice(0, 7);
    const row = byMonth.get(month);
    if (!row) return;
    row.cashIn += Number(l.debit);
    row.cashOut += Number(l.credit);
  });

  return monthsList.map((month) => ({ month, ...byMonth.get(month)! }));
}

export async function getTopCashTransactions(tenantId: string, companyId?: string, limit = 10) {
  const since = new Date(Date.now() - 180 * 86_400_000);
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      account: { tenantId, isBankOrCash: true },
      journalEntry: { tenantId, status: "posted", companyId: companyId || undefined, date: { gte: since } },
    },
    include: { account: true, journalEntry: true },
  });

  return lines
    .map((l) => ({
      date: l.journalEntry.date,
      memo: l.journalEntry.memo,
      accountName: l.account.name,
      amount: Number(l.debit) - Number(l.credit),
      direction: (Number(l.debit) > Number(l.credit) ? "in" : "out") as "in" | "out",
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, limit);
}

export async function getFinancialPosition(tenantId: string, companyId?: string, asOfDate?: Date) {
  const balanceSheet = await getBalanceSheet(tenantId, companyId, asOfDate);
  const [cashTotal, receivables, payables] = await Promise.all([
    getCashTotal(tenantId, companyId),
    getReceivablesAging(tenantId, { companyId }),
    getPayablesAging(tenantId, { companyId }),
  ]);
  const receivablesTotal = receivables.reduce((s, r) => s + r.total, 0);
  const payablesTotal = payables.reduce((s, r) => s + r.total, 0);

  const debtToEquity = balanceSheet.totalEquity !== 0 ? balanceSheet.totalLiabilities / balanceSheet.totalEquity : null;
  // لا يوجد تصنيف "متداول/غير متداول" في شجرة الحسابات حالياً، لذا نستخدم (الكاش + الذمم
  // المدينة) مقابل الذمم الدائنة كتقريب عملي لنسبة التداول بدل نسبة تداول دقيقة تحتاج تصنيفاً
  // غير متوفر بعد — موضَّح في الواجهة كـ "تقريبية"
  const currentRatioProxy = payablesTotal > 0 ? (cashTotal + receivablesTotal) / payablesTotal : null;

  return {
    totalAssets: balanceSheet.totalAssets,
    totalLiabilities: balanceSheet.totalLiabilities,
    totalEquity: balanceSheet.totalEquity,
    debtToEquity,
    currentRatioProxy,
  };
}

export async function getSalesTrend(tenantId: string, companyId?: string, months = 12) {
  const monthsList = lastNMonths(months);
  const trend = await getSalesMonthlyTrend(tenantId, { companyId });
  const byMonth = new Map(trend.map((t) => [t.month, t.total]));
  return monthsList.map((month) => ({ month, total: byMonth.get(month) || 0 }));
}

export async function getTopCustomers(tenantId: string, companyId?: string, limit = 10) {
  const rows = await getSalesByCustomer(tenantId, { companyId });
  return [...rows].sort((a, b) => b.netSales - a.netSales).slice(0, limit);
}

function nextVatDueDate(frequency: "monthly" | "quarterly", today: Date): Date {
  const candidates: Date[] = [];
  if (frequency === "monthly") {
    for (let m = -1; m <= 13; m++) candidates.push(endOfMonth(today.getFullYear(), today.getMonth() + m));
  } else {
    for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
      [3, 6, 9, 12].forEach((m) => candidates.push(endOfMonth(y, m)));
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates.find((d) => d.getTime() >= today.getTime())!;
}

export interface FinancialAlert {
  type: "overdue_invoice" | "lease_expiring" | "vat_due" | "low_cash" | "stale_draft" | "zakat_due" | "company_doc_expiring";
  companyId: string;
  companyName: string;
  title: string;
  detail: string;
  days: number | null;
}

/**
 * تنبيهات الداشبورد المالية — تُبنى لكل شركة على حدة (companyId فارغ = كل شركات المستأجر)
 * لأن حدود التنبيهات (مدة تأخر الفاتورة، الحد الأدنى للكاش...) قابلة للتحديد لكل شركة.
 */
export async function getFinancialAlerts(tenantId: string, companyId: string | undefined, withinDays = 60) {
  const companies = await prisma.company.findMany({ where: { tenantId, id: companyId || undefined } });
  const today = new Date();
  const cutoff = new Date(today.getTime() + withinDays * 86_400_000);
  const alerts: FinancialAlert[] = [];

  for (const company of companies) {
    const invoices = await invoicesWithPaid(tenantId, company.id);
    invoices
      .filter((inv) => inv.due > 0.5)
      .forEach((inv) => {
        const days = daysBetween(inv.date, today);
        if (days > company.overdueInvoiceDays) {
          alerts.push({
            type: "overdue_invoice",
            companyId: company.id,
            companyName: company.name,
            title: `فاتورة متأخرة السداد — ${inv.invoiceNumber}`,
            detail: `متأخرة ${days} يوماً، المتبقي ${inv.due.toFixed(2)} ر.س`,
            days: -days,
          });
        }
      });

    const leases = await prisma.leaseContract.findMany({ where: { tenantId, companyId: company.id, endDate: { lte: cutoff } } });
    leases.forEach((lc) => {
      const days = daysBetween(today, lc.endDate);
      alerts.push({
        type: "lease_expiring",
        companyId: company.id,
        companyName: company.name,
        title: `عقد إيجار قارب على الانتهاء — ${lc.title}`,
        detail: days >= 0 ? `ينتهي خلال ${days} يوماً` : `منتهٍ منذ ${-days} يوماً`,
        days,
      });
    });

    const vatDue = nextVatDueDate(company.vatFilingFrequency, today);
    const vatDays = daysBetween(today, vatDue);
    if (vatDays <= withinDays) {
      alerts.push({
        type: "vat_due",
        companyId: company.id,
        companyName: company.name,
        title: "موعد تقديم إقرار ضريبة القيمة المضافة",
        detail: `الموعد النهائي ${vatDue.toISOString().slice(0, 10)} (خلال ${vatDays} يوماً)`,
        days: vatDays,
      });
    }

    if (company.lowCashThreshold != null) {
      const cashTotal = await getCashTotal(tenantId, company.id);
      if (cashTotal < Number(company.lowCashThreshold)) {
        alerts.push({
          type: "low_cash",
          companyId: company.id,
          companyName: company.name,
          title: "رصيد الكاش أقل من الحد الأدنى",
          detail: `الرصيد الحالي ${cashTotal.toFixed(2)} ر.س، الحد الأدنى ${Number(company.lowCashThreshold).toFixed(2)} ر.س`,
          days: null,
        });
      }
    }

    const staleCutoff = new Date(today.getTime() - company.staleDraftDays * 86_400_000);
    const staleDrafts = await prisma.salesInvoice.findMany({
      where: { tenantId, companyId: company.id, status: "draft", createdAt: { lte: staleCutoff } },
    });
    staleDrafts.forEach((inv) => {
      const days = daysBetween(inv.createdAt, today);
      alerts.push({
        type: "stale_draft",
        companyId: company.id,
        companyName: company.name,
        title: `فاتورة مسودة لم تُرحّل — ${inv.invoiceNumber}`,
        detail: `منذ ${days} يوماً`,
        days: -days,
      });
    });

    if (company.zakatDeclarationDueDate) {
      const zDays = daysBetween(today, company.zakatDeclarationDueDate);
      if (zDays <= withinDays) {
        alerts.push({
          type: "zakat_due",
          companyId: company.id,
          companyName: company.name,
          title: "موعد تقديم إقرار الزكاة",
          detail: zDays >= 0 ? `خلال ${zDays} يوماً` : `متأخر منذ ${-zDays} يوماً`,
          days: zDays,
        });
      }
    }

    const docs = await prisma.companyDocument.findMany({ where: { tenantId, companyId: company.id, expiryDate: { lte: cutoff } } });
    docs.forEach((d) => {
      const days = d.expiryDate ? daysBetween(today, d.expiryDate) : null;
      alerts.push({
        type: "company_doc_expiring",
        companyId: company.id,
        companyName: company.name,
        title: `مستند إداري قارب على الانتهاء — ${d.docType}`,
        detail: days !== null ? (days >= 0 ? `ينتهي خلال ${days} يوماً` : `منتهٍ منذ ${-days} يوماً`) : "",
        days,
      });
    });
  }

  alerts.sort((a, b) => (a.days ?? 999_999) - (b.days ?? 999_999));
  return alerts;
}

// ---------------------------------------------------------------------------
// داشبورد شئون الموظفين
// ---------------------------------------------------------------------------

const PAYROLL_DEBIT_ACCOUNT_NAMES = PAYROLL_JOURNAL_MAP.filter(([, , dir]) => dir === "debit").map(([, name]) => name);

async function getMonthlyPayrollCost(tenantId: string, companyId: string | undefined, month: string) {
  const dateFrom = new Date(`${month}-01T00:00:00.000Z`);
  const dateTo = new Date(dateFrom.getFullYear(), dateFrom.getMonth() + 1, 0, 23, 59, 59);
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      account: { tenantId, name: { in: PAYROLL_DEBIT_ACCOUNT_NAMES } },
      journalEntry: { tenantId, status: "posted", sourceModule: "payroll", companyId: companyId || undefined, date: { gte: dateFrom, lte: dateTo } },
    },
    select: { debit: true },
  });
  return lines.reduce((s, l) => s + Number(l.debit), 0);
}

export async function getHrKpis(tenantId: string, companyId?: string) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [activeEmployeeCount, monthlyPayrollCost, employees] = await Promise.all([
    prisma.employee.count({ where: { tenantId, companyId: companyId || undefined, status: "active" } }),
    getMonthlyPayrollCost(tenantId, companyId, currentMonth),
    prisma.employee.findMany({ where: { tenantId, companyId: companyId || undefined, status: "active" } }),
  ]);

  const today = new Date();
  const accruedLeaveTotalDays = employees.reduce(
    (s, e) => s + accruedLeaveDays({ hireDate: e.hireDate, lastLeaveReturnDate: e.lastLeaveReturnDate }, today).days,
    0,
  );
  // تقدير مخصص (Provision) بافتراض إنهاء عادي من صاحب العمل اليوم لكل الموظفين النشطين —
  // وليس تصفية فعلية، لذا لا نطبّق نسبة خصم الاستقالة (المادة 85) على هذا الإجمالي
  const eosAccrualTotal = employees.reduce((s, e) => {
    const result = calcEOS(
      { basicSalary: Number(e.basicSalary), housingAllowance: Number(e.housingAllowance), hireDate: e.hireDate },
      today,
      "employer",
    );
    return s + result.finalAmount;
  }, 0);

  return { activeEmployeeCount, monthlyPayrollCost, accruedLeaveTotalDays, eosAccrualTotal };
}

export async function getHrPayrollTrend(tenantId: string, companyId?: string, months = 12) {
  const monthsList = lastNMonths(months);
  const totals = await Promise.all(monthsList.map((m) => getMonthlyPayrollCost(tenantId, companyId, m)));
  return monthsList.map((month, i) => ({ month, total: totals[i] }));
}

/** توزيع الموظفين حسب الشركة (عرض المجموعة) أو حسب الإدارة (عرض شركة واحدة محددة) */
export async function getHrHeadcountBreakdown(tenantId: string, companyId?: string) {
  if (companyId) {
    const employees = await prisma.employee.findMany({ where: { tenantId, companyId, status: "active" }, select: { department: true } });
    const byDept = new Map<string, number>();
    employees.forEach((e) => {
      const key = e.department || "غير محدد";
      byDept.set(key, (byDept.get(key) || 0) + 1);
    });
    return [...byDept.entries()].map(([label, count]) => ({ label, count }));
  }

  const employees = await prisma.employee.findMany({ where: { tenantId, status: "active" }, include: { company: true } });
  const byCompany = new Map<string, { label: string; count: number }>();
  employees.forEach((e) => {
    const row = byCompany.get(e.companyId) || { label: e.company.name, count: 0 };
    row.count += 1;
    byCompany.set(e.companyId, row);
  });
  return [...byCompany.values()];
}

export async function getHrNationalityBreakdown(tenantId: string, companyId?: string) {
  const employees = await prisma.employee.findMany({
    where: { tenantId, companyId: companyId || undefined, status: "active" },
    select: { nationality: true },
  });
  const byNat = new Map<string, number>();
  employees.forEach((e) => {
    const key = e.nationality || "غير محدد";
    byNat.set(key, (byNat.get(key) || 0) + 1);
  });
  return [...byNat.entries()].map(([label, count]) => ({ label, count }));
}

export interface HrAlert {
  type: "expiring_document" | "contract_ending" | "probation_unevaluated";
  companyId: string;
  employeeId: string;
  employeeName: string;
  title: string;
  detail: string;
  days: number | null;
}

export async function getHrAlerts(tenantId: string, companyId: string | undefined, withinDays = 60) {
  const today = new Date();
  const cutoff = new Date(today.getTime() + withinDays * 86_400_000);
  const employees = await prisma.employee.findMany({
    where: { tenantId, companyId: companyId || undefined, status: "active" },
    include: { documents: true },
  });

  const alerts: HrAlert[] = [];
  employees.forEach((emp) => {
    emp.documents.forEach((doc) => {
      if (doc.expiryDate && doc.expiryDate <= cutoff) {
        const days = daysBetween(today, doc.expiryDate);
        alerts.push({
          type: "expiring_document",
          companyId: emp.companyId,
          employeeId: emp.id,
          employeeName: emp.name,
          title: `${doc.type} — ${emp.name}`,
          detail: days >= 0 ? `ينتهي خلال ${days} يوماً` : `منتهٍ منذ ${-days} يوماً`,
          days,
        });
      }
    });

    if (emp.contractEnd && emp.contractEnd <= cutoff) {
      const days = daysBetween(today, emp.contractEnd);
      alerts.push({
        type: "contract_ending",
        companyId: emp.companyId,
        employeeId: emp.id,
        employeeName: emp.name,
        title: `عقد عمل قارب على الانتهاء — ${emp.name}`,
        detail: days >= 0 ? `ينتهي خلال ${days} يوماً` : `منتهٍ منذ ${-days} يوماً`,
        days,
      });
    }

    if (emp.probationEndDate && !emp.probationEvaluated && emp.probationEndDate <= today) {
      const days = daysBetween(emp.probationEndDate, today);
      alerts.push({
        type: "probation_unevaluated",
        companyId: emp.companyId,
        employeeId: emp.id,
        employeeName: emp.name,
        title: `تجاوز فترة التجربة بدون تقييم مسجّل — ${emp.name}`,
        detail: `منذ ${days} يوماً`,
        days: -days,
      });
    }
  });

  alerts.sort((a, b) => (a.days ?? 999_999) - (b.days ?? 999_999));
  return alerts;
}
