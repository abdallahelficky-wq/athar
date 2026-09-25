import { prisma } from "./prisma";
export const money = (value: number) => Math.round(value * 100) / 100;
export function summarizeInvoiceCredits(invoice: { grandTotal: unknown; receiptAllocations: { amount: unknown }[] }, notes: { status: string; grandTotal: unknown; refundMethod?: string | null }[]) {
  const posted = notes.filter((note) => note.status === "posted");
  const returnedAmount = money(posted.reduce((sum, note) => sum + Number(note.grandTotal), 0));
  const accountCreditAmount = money(posted.filter((note) => !note.refundMethod || note.refundMethod === "account").reduce((sum, note) => sum + Number(note.grandTotal), 0));
  const paidAmount = money(invoice.receiptAllocations.reduce((sum, alloc) => sum + Number(alloc.amount), 0));
  const balance = money(Number(invoice.grandTotal) - accountCreditAmount - paidAmount);
  return { returnedAmount, accountCreditAmount, paidAmount, netGrandTotal: money(Number(invoice.grandTotal) - returnedAmount),
    outstandingAmount: Math.max(0, balance), customerCreditAmount: Math.max(0, -balance),
    returnStatus: returnedAmount === 0 ? "none" : returnedAmount >= Number(invoice.grandTotal) - 0.01 ? "full" : "partial" };
}
export async function getInvoiceCreditNotes(tenantId: string, invoiceIds: string[]) {
  if (!invoiceIds.length) return [];
  return prisma.salesReturn.findMany({ where: { tenantId, relatedInvoiceId: { in: invoiceIds } },
    select: { id: true, relatedInvoiceId: true, returnNumber: true, status: true, grandTotal: true, refundMethod: true, reason: true, date: true,
      lines: { select: { originalInvoiceLineId: true, quantity: true } } }, orderBy: { createdAt: "desc" } });
}
export async function withInvoiceCredits<T extends { id: string; grandTotal: unknown; receiptAllocations: { amount: unknown }[] }>(tenantId: string, invoices: T[]) {
  const notes = await getInvoiceCreditNotes(tenantId, invoices.map((invoice) => invoice.id));
  return invoices.map((invoice) => {
    const creditNotes = notes.filter((note) => note.relatedInvoiceId === invoice.id);
    const summary = summarizeInvoiceCredits(invoice, creditNotes);
    return { ...invoice, ...summary, creditNotes,
      paymentStatus: summary.outstandingAmount <= 0.01 ? "مسددة" : summary.paidAmount > 0 || summary.accountCreditAmount > 0 ? "مسددة جزئياً" : "غير مسددة" };
  });
}
