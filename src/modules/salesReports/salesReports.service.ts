import { prisma } from "../../lib/prisma";
import { round2, type VatPeriod } from "../../lib/vatPeriod";
import { receivablesAgingAsOf } from "../../lib/aging";
import { OUTPUT_VAT_ACCOUNT_NAME, resolveVatAccount, stationShiftOutputVat } from "../../lib/vatAccounts";

import { dateWhere, type ReportFilters } from "../../lib/reportFilters";

type Filters = ReportFilters;

export async function invoicesWithPaid(tenantId: string, companyId?: string, period: Pick<Filters, "start" | "endExclusive"> = {}) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, companyId: companyId || undefined, status: "posted", ...dateWhere(period) },
    include: { receiptAllocations: true, customer: true },
  });
  return invoices.map((inv) => {
    const paid = inv.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
    return { ...inv, paid, due: Number(inv.grandTotal) - paid };
  });
}

export async function getSalesByCustomer(tenantId: string, filters: Filters) {
  const [invoices, returns] = await Promise.all([
    invoicesWithPaid(tenantId, filters.companyId, filters),
    prisma.salesReturn.findMany({
      where: { tenantId, companyId: filters.companyId || undefined, status: "posted", ...dateWhere(filters) },
      include: { customer: true },
    }),
  ]);

  const byCustomer = new Map<string, {
    customerId: string; customerName: string; invoiceCount: number; totalInvoices: number;
    totalReturns: number; netSales: number; outstanding: number;
  }>();

  invoices.forEach((inv) => {
    const row = byCustomer.get(inv.customerId) || {
      customerId: inv.customerId, customerName: inv.customer.name, invoiceCount: 0,
      totalInvoices: 0, totalReturns: 0, netSales: 0, outstanding: 0,
    };
    row.invoiceCount += 1;
    row.totalInvoices += Number(inv.grandTotal);
    row.outstanding += inv.due;
    byCustomer.set(inv.customerId, row);
  });

  returns.forEach((ret) => {
    const row = byCustomer.get(ret.customerId) || {
      customerId: ret.customerId, customerName: ret.customer.name, invoiceCount: 0,
      totalInvoices: 0, totalReturns: 0, netSales: 0, outstanding: 0,
    };
    row.totalReturns += Number(ret.grandTotal);
    byCustomer.set(ret.customerId, row);
  });

  return [...byCustomer.values()].map((r) => ({ ...r, netSales: r.totalInvoices - r.totalReturns }));
}

export async function getSalesMonthlyTrend(tenantId: string, filters: Filters) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, status: "posted", ...dateWhere(filters) },
    select: { date: true, grandTotal: true },
  });
  const byMonth = new Map<string, number>();
  invoices.forEach((inv) => {
    const month = inv.date.toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + Number(inv.grandTotal));
  });
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({ month, total }));
}

/**
 * ملخص ضريبة المخرجات لشركة واحدة عن فترة إقرار محددة (parseVatPeriod يرفض أي طلب بلا شركة أو
 * فترة). المستندات المرحَّلة المؤرَّخة داخل الفترة: الفواتير + الإشعارات المدينة − المردودات.
 * ضريبة ورديات المحطات سطر مستقل خارج مجموع المستندات: تُرحَّل إلى نفس حساب المخرجات بلا أي مستند
 * ضريبي خلفها، وقد تتداخل مع فواتير وقود من نقطة البيع لنفس اليوم — فلا تُدمَج بصمت.
 */
export async function getSalesVatSummary(tenantId: string, period: VatPeriod) {
  const where = { tenantId, companyId: period.companyId, status: "posted" as const, date: { gte: period.start, lt: period.endExclusive } };
  const sum = { _sum: { subtotal: true, vatTotal: true }, _count: { _all: true } } as const;
  const [invoices, returns, debitNotes, outputAccount] = await Promise.all([
    prisma.salesInvoice.aggregate({ where, ...sum }),
    prisma.salesReturn.aggregate({ where, ...sum }),
    prisma.salesDebitNote.aggregate({ where, ...sum }),
    resolveVatAccount(tenantId, period.companyId, OUTPUT_VAT_ACCOUNT_NAME),
  ]);
  const station = await stationShiftOutputVat(tenantId, period, outputAccount?.id ?? null);
  const salesBase = Number(invoices._sum.subtotal ?? 0);
  const outputVat = Number(invoices._sum.vatTotal ?? 0);
  const returnsBase = Number(returns._sum.subtotal ?? 0);
  const returnsVat = Number(returns._sum.vatTotal ?? 0);
  const debitNotesBase = Number(debitNotes._sum.subtotal ?? 0);
  const debitNotesVat = Number(debitNotes._sum.vatTotal ?? 0);
  const netOutputVat = round2(outputVat + debitNotesVat - returnsVat);
  return {
    period: { companyId: period.companyId, from: period.from, to: period.to },
    invoiceCount: invoices._count._all, salesBase, outputVat,
    debitNoteCount: debitNotes._count._all, debitNotesBase, debitNotesVat,
    returnCount: returns._count._all, returnsBase, returnsVat,
    netSalesBase: round2(salesBase + debitNotesBase - returnsBase), netOutputVat,
    stationShiftVat: round2(station.vat), stationShiftCount: station.shiftCount,
    totalOutputVatWithStations: round2(netOutputVat + station.vat),
  };
}

/** أعمار الذمم المدينة كما في تاريخ (الافتراضي اليوم) — راجع lib/aging.ts. الإجمالي لكل عميل رصيد حسابه في الأستاذ.
 * TODO: العمر من تاريخ الفاتورة لا من dueDate الفعلي — راجع "ملاحظة معلّقة" في README.md الجذر. */
export async function getReceivablesAging(tenantId: string, filters: Filters & { asOf?: Date }) {
  const report = await receivablesAgingAsOf(tenantId, filters.companyId, filters.asOf ?? new Date());
  return report.rows.map(({ partyId, partyName, ...b }) => ({ customerId: partyId, customerName: partyName, ...b }));
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * المبيعات حسب الصنف مع مجمل الربح: فواتير مرحَّلة في الفترة (قبل الضريبة) ناقص مردوداتها المرحَّلة في الفترة (عبر
 * سطر الفاتورة الأصلي). التكلفة = حركات الصرف المرتبطة بسطر الفاتورة (sourceSalesInvoiceLineId) بتكلفتها اللحظية —
 * نفس ما رُحِّل لتكلفة المبيعات. المردود لا يُرجع مخزوناً ولا تكلفة في النظام، فلا تُعكس تكلفته هنا أيضاً.
 * مبيعات ورديات المحطات ليست فواتير فلا تظهر هنا (لها تقارير الورديات).
 */
export async function getSalesByItem(tenantId: string, filters: Filters) {
  const invoiceWhere = { tenantId, companyId: filters.companyId || undefined, status: "posted" as const, branchId: filters.branchId || undefined, ...dateWhere(filters) };
  const [lines, returnLines] = await Promise.all([
    prisma.salesInvoiceLine.findMany({ where: { invoice: invoiceWhere }, include: { item: true } }),
    prisma.salesReturnLine.findMany({
      where: { salesReturn: { tenantId, companyId: filters.companyId || undefined, status: "posted", ...dateWhere(filters) } },
      select: { quantity: true, subtotal: true, originalInvoiceLineId: true },
    }),
  ]);
  const originalIds = [...new Set(returnLines.map((l) => l.originalInvoiceLineId).filter((id): id is string => !!id))];
  const [movements, originals] = await Promise.all([
    lines.length
      ? prisma.stockMovement.findMany({ where: { tenantId, sourceSalesInvoiceLineId: { in: lines.map((l) => l.id) } }, select: { sourceSalesInvoiceLineId: true, quantity: true, unitCost: true, type: true } })
      : [],
    originalIds.length ? prisma.salesInvoiceLine.findMany({ where: { id: { in: originalIds }, invoice: { tenantId } }, include: { item: true, invoice: { select: { branchId: true } } } }) : [],
  ]);
  const costByLine = new Map<string, number>();
  for (const m of movements) {
    if (!m.sourceSalesInvoiceLineId || m.type !== "out") continue;
    costByLine.set(m.sourceSalesInvoiceLineId, (costByLine.get(m.sourceSalesInvoiceLineId) || 0) + Number(m.quantity) * Number(m.unitCost));
  }
  type Row = { itemId: string | null; itemCode: string; itemName: string; itemNameEn: string | null; unit: string; quantity: number; sales: number; returnQuantity: number; returns: number; cost: number };
  const rows = new Map<string, Row>();
  const row = (item: { id: string; code: string; name: string; nameEn: string | null; unit: string | null } | null) => {
    const key = item?.id ?? "__none__";
    if (!rows.has(key)) rows.set(key, { itemId: item?.id ?? null, itemCode: item?.code ?? "", itemName: item?.name ?? "", itemNameEn: item?.nameEn ?? null, unit: item?.unit ?? "", quantity: 0, sales: 0, returnQuantity: 0, returns: 0, cost: 0 });
    return rows.get(key)!;
  };
  for (const l of lines) {
    const r = row(l.item);
    r.quantity += Number(l.quantity);
    r.sales += Number(l.subtotal);
    r.cost += costByLine.get(l.id) || 0;
  }
  const originalById = new Map(originals.map((o) => [o.id, o]));
  for (const rl of returnLines) {
    const original = rl.originalInvoiceLineId ? originalById.get(rl.originalInvoiceLineId) : undefined;
    // مردود فرع آخر لا يُخصم من تقرير فرع محدد
    if (filters.branchId && original?.invoice.branchId !== filters.branchId) continue;
    const r = row(original?.item ?? null);
    r.returnQuantity += Number(rl.quantity);
    r.returns += Number(rl.subtotal);
  }
  return [...rows.values()]
    .map((r) => {
      const netSales = r.sales - r.returns;
      const grossProfit = netSales - r.cost;
      return {
        ...r,
        quantity: r2(r.quantity), sales: r2(r.sales), returnQuantity: r2(r.returnQuantity), returns: r2(r.returns), cost: r2(r.cost),
        netQuantity: r2(r.quantity - r.returnQuantity), netSales: r2(netSales), grossProfit: r2(grossProfit),
        margin: Math.abs(netSales) < 0.005 ? null : Math.round((grossProfit / netSales) * 10000) / 10000,
      };
    })
    .sort((a, b) => b.netSales - a.netSales);
}

/** المبيعات حسب الفرع: الفواتير المرحَّلة في الفترة ومردوداتها (فرع المردود = فرع فاتورته الأصلية). */
export async function getSalesByBranch(tenantId: string, filters: Filters) {
  const where = { tenantId, companyId: filters.companyId || undefined, status: "posted" as const, ...dateWhere(filters) };
  const [invoices, returns, branches] = await Promise.all([
    prisma.salesInvoice.findMany({ where, select: { branchId: true, subtotal: true, vatTotal: true } }),
    prisma.salesReturn.findMany({ where, select: { subtotal: true, vatTotal: true, relatedInvoiceId: true } }),
    prisma.branch.findMany({ where: { tenantId, companyId: filters.companyId || undefined }, select: { id: true, nameAr: true, nameEn: true } }),
  ]);
  const related = returns.map((r) => r.relatedInvoiceId).filter((id): id is string => !!id);
  const relatedBranch = new Map(
    (related.length ? await prisma.salesInvoice.findMany({ where: { tenantId, id: { in: related } }, select: { id: true, branchId: true } }) : []).map((i) => [i.id, i.branchId]),
  );
  const byBranch = new Map<string, { branchId: string | null; invoiceCount: number; sales: number; vat: number; returns: number }>();
  const get = (id: string | null) => {
    const key = id ?? "__none__";
    if (!byBranch.has(key)) byBranch.set(key, { branchId: id, invoiceCount: 0, sales: 0, vat: 0, returns: 0 });
    return byBranch.get(key)!;
  };
  invoices.forEach((i) => { const r = get(i.branchId); r.invoiceCount += 1; r.sales += Number(i.subtotal); r.vat += Number(i.vatTotal); });
  returns.forEach((ret) => { const r = get(ret.relatedInvoiceId ? relatedBranch.get(ret.relatedInvoiceId) ?? null : null); r.returns += Number(ret.subtotal); r.vat -= Number(ret.vatTotal); });
  const names = new Map(branches.map((b) => [b.id, b]));
  return [...byBranch.values()]
    .map((r) => ({ ...r, branchName: r.branchId ? names.get(r.branchId)?.nameAr ?? "—" : null, branchNameEn: r.branchId ? names.get(r.branchId)?.nameEn ?? null : null, sales: r2(r.sales), vat: r2(r.vat), returns: r2(r.returns), netSales: r2(r.sales - r.returns) }))
    .sort((a, b) => b.netSales - a.netSales);
}
