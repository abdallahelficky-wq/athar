import { payablesAgingAsOf } from "../../lib/aging";
import { prisma } from "../../lib/prisma";
import { round2, type VatPeriod } from "../../lib/vatPeriod";

interface Filters {
  companyId?: string;
}

export async function getPurchasesBySupplier(tenantId: string, filters: Filters) {
  const [invoices, returns] = await Promise.all([
    prisma.purchaseInvoice.findMany({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted" }, include: { supplier: true } }),
    prisma.purchaseReturn.findMany({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted" }, include: { supplier: true } }),
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
    where: { tenantId, companyId: filters.companyId || undefined, status: "posted" },
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
