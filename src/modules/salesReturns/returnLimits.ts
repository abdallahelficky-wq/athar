import { badRequest } from "../../lib/httpError";
type Line = { id?: string; originalInvoiceLineId?: string | null; quantity: unknown; total?: unknown; accountId?: string };
export function assertReturnLimits(invoice: { grandTotal: unknown; lines: Line[] }, previous: { status: string; grandTotal: unknown; lines: Line[] }[], lines: Line[], grandTotal: number) {
  const reserved = previous.filter((note) => note.status !== "draft");
  const used = reserved.reduce((sum, note) => sum + Number(note.grandTotal), 0);
  if (Math.round((used + grandTotal) * 100) > Math.round(Number(invoice.grandTotal) * 100)) throw badRequest("قيمة المرتجع تتجاوز المتبقي القابل للإرجاع من الفاتورة");
  const requested = new Map<string, number>();
  for (const line of lines) {
    if (!line.originalInvoiceLineId) continue; // Historical notes may have no line reference.
    const original = invoice.lines.find((item) => item.id === line.originalInvoiceLineId);
    if (!original || original.accountId !== line.accountId) throw badRequest("أحد أصناف المرتجع لا ينتمي إلى الفاتورة الأصلية");
    requested.set(line.originalInvoiceLineId, (requested.get(line.originalInvoiceLineId) || 0) + Number(line.quantity));
  }
  for (const [id, quantity] of requested) {
    const usedQuantity = reserved.flatMap((note) => note.lines).filter((line) => line.originalInvoiceLineId === id).reduce((sum, line) => sum + Number(line.quantity), 0);
    if (usedQuantity + quantity > Number(invoice.lines.find((line) => line.id === id)!.quantity) + 0.00001) throw badRequest("كمية المرتجع تتجاوز الكمية المتبقية في الفاتورة الأصلية");
  }
}
