export function returnInvoiceLines(invoice) {
 const reserved = (invoice.creditNotes || []).filter((note) => note.status !== "draft").flatMap((note) => note.lines || []);
 return invoice.lines.map((line) => ({
  originalInvoiceLineId: line.id, accountId: line.accountId, description: line.description || line.item?.name || "",
  quantity: Math.max(0, Number(line.quantity) - reserved.filter((r) => r.originalInvoiceLineId === line.id).reduce((sum, r) => sum + Number(r.quantity), 0)),
  unitPrice: Number(line.unitPrice), discountPct: Number(line.discountPct), priceIncludesVat: line.priceIncludesVat, vatApplicable: line.vatApplicable,
 })).filter((line) => line.quantity > 0);
}
