import { prisma } from "../../lib/prisma";

interface Filters {
  companyId?: string;
}

export async function invoicesWithPaid(tenantId: string, companyId?: string) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, companyId: companyId || undefined, status: "posted" },
    include: { receiptAllocations: true, customer: true },
  });
  return invoices.map((inv) => {
    const paid = inv.receiptAllocations.reduce((s, a) => s + Number(a.amount), 0);
    return { ...inv, paid, due: Number(inv.grandTotal) - paid };
  });
}

export async function getSalesByCustomer(tenantId: string, filters: Filters) {
  const [invoices, returns] = await Promise.all([
    invoicesWithPaid(tenantId, filters.companyId),
    prisma.salesReturn.findMany({
      where: { tenantId, companyId: filters.companyId || undefined, status: "posted" },
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

export async function getSalesVatSummary(tenantId: string, filters: Filters) {
  const [invoices, returns] = await Promise.all([
    prisma.salesInvoice.findMany({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted" }, select: { vatTotal: true, subtotal: true } }),
    prisma.salesReturn.findMany({ where: { tenantId, companyId: filters.companyId || undefined, status: "posted" }, select: { vatTotal: true, subtotal: true } }),
  ]);
  const salesBase = invoices.reduce((s, i) => s + Number(i.subtotal), 0);
  const outputVat = invoices.reduce((s, i) => s + Number(i.vatTotal), 0);
  const returnsBase = returns.reduce((s, r) => s + Number(r.subtotal), 0);
  const returnsVat = returns.reduce((s, r) => s + Number(r.vatTotal), 0);
  return {
    salesBase, outputVat, returnsBase, returnsVat,
    netSalesBase: salesBase - returnsBase, netOutputVat: outputVat - returnsVat,
  };
}

/** أعمار الذمم — يبني حِزَم 0-30/31-60/61-90/90+ يوماً من تاريخ كل فاتورة مستحقة حتى اليوم
 * TODO: يحسب من تاريخ الفاتورة لا من dueDate الفعلي — راجع "ملاحظة معلّقة" في README.md
 * الجذر لتفاصيل الأثر وسبب تأجيل معالجتها. */
export async function getReceivablesAging(tenantId: string, filters: Filters) {
  const invoices = await invoicesWithPaid(tenantId, filters.companyId);
  const today = new Date();

  const byCustomer = new Map<string, { customerId: string; customerName: string; current: number; d30: number; d60: number; d90: number; total: number }>();
  invoices.filter((i) => i.due > 0.5).forEach((inv) => {
    const days = Math.floor((today.getTime() - inv.date.getTime()) / 86_400_000);
    const row = byCustomer.get(inv.customerId) || { customerId: inv.customerId, customerName: inv.customer.name, current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
    if (days <= 30) row.current += inv.due;
    else if (days <= 60) row.d30 += inv.due;
    else if (days <= 90) row.d60 += inv.due;
    else row.d90 += inv.due;
    row.total += inv.due;
    byCustomer.set(inv.customerId, row);
  });

  return [...byCustomer.values()];
}
