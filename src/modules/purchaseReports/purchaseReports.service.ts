import { payablesAgingAsOf } from "../../lib/aging";
import { prisma } from "../../lib/prisma";
import { round2, type VatPeriod } from "../../lib/vatPeriod";

import { dateWhere, type ReportFilters } from "../../lib/reportFilters";

type Filters = ReportFilters;

export async function getPurchasesBySupplier(tenantId: string, filters: Filters) {
  const [invoices, returns] = await Promise.all([
    prisma.purchaseInvoice.findMany({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted", ...dateWhere(filters) }, include: { supplier: true } }),
    prisma.purchaseReturn.findMany({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted", ...dateWhere(filters) }, include: { supplier: true } }),
  ]);

  const bySupplier = new Map<string, { supplierId: string; supplierName: string; invoiceCount: number; totalInvoices: number; totalReturns: number; netPurchases: number }>();

  invoices.forEach((inv) => {
    const row = bySupplier.get(inv.supplierId) || { supplierId: inv.supplierId, supplierName: inv.supplier.name, invoiceCount: 0, totalInvoices: 0, totalReturns: 0, netPurchases: 0 };
    row.invoiceCount += 1;
    row.totalInvoices += Number(inv.grandTotal);
    bySupplier.set(inv.supplierId, row);
  });
  returns.forEach((ret) => {
    const row = bySupplier.get(ret.supplierId) || { supplierId: ret.supplierId, supplierName: ret.supplier.name, invoiceCount: 0, totalInvoices: 0, totalReturns: 0, netPurchases: 0 };
    row.totalReturns += Number(ret.grandTotal);
    bySupplier.set(ret.supplierId, row);
  });

  return [...bySupplier.values()].map((r) => ({ ...r, netPurchases: r.totalInvoices - r.totalReturns }));
}

export async function getPurchasesMonthlyTrend(tenantId: string, filters: Filters) {
  const invoices = await prisma.purchaseInvoice.findMany({
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
 * ملخص ضريبة المدخلات لشركة واحدة عن فترة إقرار محددة. تاريخ الضريبة هو تاريخ فاتورة المورد
 * (`date`) — المستندات المرحَّلة المؤرَّخة داخل الفترة: فواتير المشتريات − مردوداتها.
 */
export async function getPurchasesVatSummary(tenantId: string, period: VatPeriod) {
  const where = { tenantId, companyId: period.companyId, status: "posted" as const, date: { gte: period.start, lt: period.endExclusive } };
  const sum = { _sum: { subtotal: true, vatTotal: true }, _count: { _all: true } } as const;
  const [invoices, returns] = await Promise.all([
    prisma.purchaseInvoice.aggregate({ where, ...sum }),
    prisma.purchaseReturn.aggregate({ where, ...sum }),
  ]);
  const purchasesBase = Number(invoices._sum.subtotal ?? 0);
  const inputVat = Number(invoices._sum.vatTotal ?? 0);
  const returnsBase = Number(returns._sum.subtotal ?? 0);
  const returnsVat = Number(returns._sum.vatTotal ?? 0);
  return {
    period: { companyId: period.companyId, from: period.from, to: period.to },
    invoiceCount: invoices._count._all, purchasesBase, inputVat,
    returnCount: returns._count._all, returnsBase, returnsVat,
    netPurchasesBase: round2(purchasesBase - returnsBase), netInputVat: round2(inputVat - returnsVat),
  };
}

/** أعمار الذمم الدائنة كما في تاريخ (الافتراضي اليوم) — راجع lib/aging.ts. لا يوجد سند صرف بعد: السداد قيود يومية
 * على حساب المورد، فالرصيد في الأستاذ يُوزَّع على فواتيره من الأحدث للأقدم، والزائد "غير مخصَّص". */
export async function getPayablesAging(tenantId: string, filters: Filters & { asOf?: Date }) {
  const report = await payablesAgingAsOf(tenantId, filters.companyId, filters.asOf ?? new Date());
  return report.rows.map(({ partyId, partyName, ...b }) => ({ supplierId: partyId, supplierName: partyName, ...b }));
}

/**
 * المشتريات حسب الصنف: سطور فواتير المشتريات المرحَّلة في الفترة (قبل الضريبة). سطور بلا صنف (مصروفات) تُجمَع حسب
 * حسابها. مردود المشتريات بلا ربط بسطر الأصل في النظام فيظهر كإجمالي منفصل لا مخصوماً من صنف بعينه.
 */
export async function getPurchasesByItem(tenantId: string, filters: Filters) {
  const where = { tenantId, companyId: filters.companyId || undefined, status: "posted" as const, branchId: filters.branchId || undefined, ...dateWhere(filters) };
  const [lines, returns] = await Promise.all([
    prisma.purchaseInvoiceLine.findMany({ where: { invoice: where }, include: { item: true, account: true } }),
    prisma.purchaseReturn.aggregate({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted", ...dateWhere(filters) }, _sum: { subtotal: true }, _count: { _all: true } }),
  ]);
  const rows = new Map<string, { key: string; itemId: string | null; code: string; name: string; nameEn: string | null; unit: string | null; isItem: boolean; quantity: number; amount: number; invoiceIds: Set<string> }>();
  for (const l of lines) {
    const key = l.itemId ? `i:${l.itemId}` : `a:${l.accountId}`;
    if (!rows.has(key)) {
      rows.set(key, l.item
        ? { key, itemId: l.item.id, code: l.item.code, name: l.item.name, nameEn: l.item.nameEn, unit: l.item.unit, isItem: true, quantity: 0, amount: 0, invoiceIds: new Set() }
        : { key, itemId: null, code: l.account.code, name: l.account.name, nameEn: l.account.nameEn, unit: null, isItem: false, quantity: 0, amount: 0, invoiceIds: new Set() });
    }
    const r = rows.get(key)!;
    r.quantity += Number(l.quantity);
    r.amount += Number(l.subtotal);
    r.invoiceIds.add(l.invoiceId);
  }
  return {
    rows: [...rows.values()]
      .map(({ invoiceIds, ...r }) => ({ ...r, invoiceCount: invoiceIds.size, quantity: round2(r.quantity), amount: round2(r.amount), averageCost: r.isItem && r.quantity > 0 ? round2(r.amount / r.quantity) : null }))
      .sort((a, b) => b.amount - a.amount),
    returnsTotal: round2(Number(returns._sum.subtotal ?? 0)),
    returnCount: returns._count._all,
  };
}
