import { prisma } from "../../lib/prisma";

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

export async function getPurchasesVatSummary(tenantId: string, filters: Filters) {
  const [invoices, returns] = await Promise.all([
    prisma.purchaseInvoice.findMany({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted" }, select: { vatTotal: true, subtotal: true } }),
    prisma.purchaseReturn.findMany({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted" }, select: { vatTotal: true, subtotal: true } }),
  ]);
  const purchasesBase = invoices.reduce((s, i) => s + Number(i.subtotal), 0);
  const inputVat = invoices.reduce((s, i) => s + Number(i.vatTotal), 0);
  const returnsBase = returns.reduce((s, r) => s + Number(r.subtotal), 0);
  const returnsVat = returns.reduce((s, r) => s + Number(r.vatTotal), 0);
  return {
    purchasesBase, inputVat, returnsBase, returnsVat,
    netPurchasesBase: purchasesBase - returnsBase, netInputVat: inputVat - returnsVat,
  };
}

/** أعمار الذمم الدائنة — نفس منطق أعمار الذمم المدينة لكن للفواتير غير المدفوعة للموردين */
export async function getPayablesAging(tenantId: string, filters: Filters) {
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, status: "posted" },
    include: { supplier: true },
  });
  const today = new Date();

  // ملاحظة: لا يوجد بعد موديول "سند صرف" لتسجيل سداد فواتير الموردين، لذا كل فاتورة مورد
  // مرحّلة تُعتبر مستحقة بالكامل حتى بناء ذلك الموديول (خارج نطاق هذه المرحلة).
  const bySupplier = new Map<string, { supplierId: string; supplierName: string; current: number; d30: number; d60: number; d90: number; total: number }>();
  invoices.forEach((inv) => {
    const due = Number(inv.grandTotal);
    const days = Math.floor((today.getTime() - inv.date.getTime()) / 86_400_000);
    const row = bySupplier.get(inv.supplierId) || { supplierId: inv.supplierId, supplierName: inv.supplier.name, current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
    if (days <= 30) row.current += due;
    else if (days <= 60) row.d30 += due;
    else if (days <= 90) row.d60 += due;
    else row.d90 += due;
    row.total += due;
    bySupplier.set(inv.supplierId, row);
  });

  return [...bySupplier.values()];
}
