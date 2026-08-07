import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { buildPlainInvoicePdf } from "../../lib/invoicePdf";
import { sendInvoiceEmail } from "../../lib/mailer";

export interface SendInvoiceEmailResult {
  sent: boolean;
  reason?: "no_email" | "send_failed";
}

/**
 * يبني PDF الفاتورة ويرسله بالإيميل لعنوان العميل المسجَّل (أو عنوان بديل لمرة واحدة عبر
 * overrideEmail)، ويسجّل نتيجة كل محاولة في InvoiceEmailLog. لا يرمي أبداً بسبب فشل الإرسال
 * نفسه (خدمة Resend متوقفة، أو فشل توليد PDF) — يُعيد `{ sent: false }` بدلاً من ذلك حتى لا
 * توقف هذه الميزة عملية الترحيل التي استدعتها (انظر postSalesInvoice).
 */
export async function sendInvoiceByEmail(
  tenantId: string,
  invoiceId: string,
  opts: { method: "auto" | "manual"; overrideEmail?: string },
): Promise<SendInvoiceEmailResult> {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { lines: { include: { account: true } }, customer: true, company: true },
  });
  if (!invoice) throw notFound("الفاتورة غير موجودة");
  if (invoice.status !== "posted") throw badRequest("لا يمكن إرسال فاتورة لم تُرحَّل بعد");

  const to = opts.overrideEmail || invoice.customer.email;
  if (!to) return { sent: false, reason: "no_email" };

  try {
    const companyAddress = [invoice.company.addressBuilding, invoice.company.addressStreet, invoice.company.addressCity]
      .filter(Boolean)
      .join("، ");

    const pdfBuffer = await buildPlainInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      companyName: invoice.company.name,
      companyVatNumber: invoice.company.vatNumber,
      companyAddress: companyAddress || null,
      brandColor: invoice.company.brandColor,
      customerName: invoice.customer.name,
      customerVatNumber: invoice.customer.vatNumber,
      lines: invoice.lines.map((l) => ({
        description: l.description || l.account.name,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        subtotal: Number(l.subtotal),
        vat: Number(l.vat),
        total: Number(l.total),
      })),
      subtotal: Number(invoice.subtotal),
      vatTotal: Number(invoice.vatTotal),
      grandTotal: Number(invoice.grandTotal),
      qrPayload: invoice.qrPayload,
      zatcaUuid: invoice.zatcaUuid,
    });

    await sendInvoiceEmail({
      to,
      customerName: invoice.customer.name,
      invoiceNumber: invoice.invoiceNumber,
      grandTotal: Number(invoice.grandTotal).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      companyName: invoice.company.name,
      pdfBuffer,
      pdfFileName: `فاتورة-${invoice.invoiceNumber}.pdf`,
    });

    await prisma.invoiceEmailLog.create({ data: { tenantId, invoiceId, sentTo: to, method: opts.method, success: true } });
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("فشل إرسال إيميل الفاتورة:", err);
    await prisma.invoiceEmailLog.create({
      data: { tenantId, invoiceId, sentTo: to, method: opts.method, success: false, error: err instanceof Error ? err.message : String(err) },
    });
    return { sent: false, reason: "send_failed" };
  }
}
