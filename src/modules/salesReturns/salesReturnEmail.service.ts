import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { buildPlainCreditNotePdf } from "../../lib/invoicePdf";
import { sendCreditNoteEmail } from "../../lib/mailer";
import type { Lang } from "../../lib/i18n/translate";
import { currencyLabel } from "../../lib/countries";

const returnPdfInclude = { lines: { include: { account: true } }, customer: true, company: true } as const;

/**
 * يبني PDF إشعار الدائن نفسه — راجع buildPlainCreditNotePdf: نفس أنبوب buildPlainInvoicePdf
 * بالضبط (invoiceHtmlTemplate.ts + renderHtmlToPdf)، بلا XML موقّع مُرفَق، بعنوان "إشعار دائن"
 * وسطري الفاتورة الأصلية/السبب. relatedInvoiceId اختياري (إشعار داخلي بلا فاتورة مرتبطة) — عندئذٍ
 * يُعرَض المستند بلا هذين السطرين، لا خطأ.
 */
async function buildCreditNotePdfBuffer(tenantId: string, salesReturn: {
  returnNumber: string; date: Date; subtotal: unknown; vatTotal: unknown; grandTotal: unknown;
  qrPayload?: string | null; zatcaUuid: string; reason: string | null; relatedInvoiceId: string | null;
  companyId: string;
  customer: { name: string; vatNumber: string | null };
  company: { name: string; vatNumber: string | null; brandColor: string | null; addressBuilding: string | null; addressStreet: string | null; addressCity: string | null };
  lines: { description: string | null; account: { name: string }; quantity: unknown; unitPrice: unknown; subtotal: unknown; vat: unknown; total: unknown }[];
}): Promise<Buffer> {
  const companyAddress = [salesReturn.company.addressBuilding, salesReturn.company.addressStreet, salesReturn.company.addressCity].filter(Boolean).join("، ");
  let billingReferenceNumber: string | null = null;
  let billingReferenceDate: string | null = null;
  if (salesReturn.relatedInvoiceId) {
    const original = await prisma.salesInvoice.findFirst({ where: { id: salesReturn.relatedInvoiceId, tenantId }, select: { invoiceNumber: true, date: true } });
    if (original) {
      billingReferenceNumber = original.invoiceNumber;
      billingReferenceDate = original.date.toISOString().slice(0, 10);
    }
  }

  return buildPlainCreditNotePdf({
    returnNumber: salesReturn.returnNumber,
    date: salesReturn.date,
    companyName: salesReturn.company.name,
    companyVatNumber: salesReturn.company.vatNumber,
    companyAddress: companyAddress || null,
    brandColor: salesReturn.company.brandColor,
    customerName: salesReturn.customer.name,
    customerVatNumber: salesReturn.customer.vatNumber,
    lines: salesReturn.lines.map((l) => ({
      description: l.description || l.account.name,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.subtotal),
      vat: Number(l.vat),
      total: Number(l.total),
    })),
    subtotal: Number(salesReturn.subtotal),
    vatTotal: Number(salesReturn.vatTotal),
    grandTotal: Number(salesReturn.grandTotal),
    qrPayload: salesReturn.qrPayload,
    zatcaUuid: salesReturn.zatcaUuid,
    billingReferenceNumber,
    billingReferenceDate,
    reason: salesReturn.reason,
  });
}

/** تحميل PDF إشعار الدائن — لزر "تحميل PDF" في شاشة عرضه، بنفس شرط تحميل فاتورة المبيعات
 * (getSalesInvoicePdf): مرحّل فقط، "نسخة رسمية" لمسودة لم تُرقَّم/تُرحَّل بعد لا معنى لها. */
export async function getSalesReturnPdf(tenantId: string, id: string): Promise<{ buffer: Buffer; fileName: string }> {
  const salesReturn = await prisma.salesReturn.findFirst({ where: { id, tenantId }, include: returnPdfInclude });
  if (!salesReturn) throw notFound("المردود غير موجود");
  if (salesReturn.status !== "posted") throw badRequest("لا يمكن تحميل PDF لمردود لم يُرحَّل بعد");
  const buffer = await buildCreditNotePdfBuffer(tenantId, salesReturn);
  return { buffer, fileName: `credit-note-${salesReturn.returnNumber}.pdf` };
}

export interface SendCreditNoteEmailResult {
  sent: boolean;
  reason?: "no_email" | "send_failed";
}

/**
 * إرسال يدوي لإشعار دائن بالإيميل — راجع sendCreditNoteEmail في mailer.ts: لا سجل InvoiceEmailLog
 * (مرتبط بـSalesInvoice تحديداً)، فلا "متابعة فواتير لم يصلها بريدها" لإشعارات الدائن حالياً؛ فجوة
 * مُعلَنة صراحةً في تقرير هذه الميزة، لا سهواً. الإرسال نفسه ينجح/يفشل ويُبلَّغ فوراً في الواجهة.
 */
export async function sendSalesReturnByEmail(tenantId: string, id: string, overrideEmail?: string): Promise<SendCreditNoteEmailResult> {
  const salesReturn = await prisma.salesReturn.findFirst({ where: { id, tenantId }, include: returnPdfInclude });
  if (!salesReturn) throw notFound("المردود غير موجود");
  if (salesReturn.status !== "posted") throw badRequest("لا يمكن إرسال مردود لم يُرحَّل بعد");

  const to = overrideEmail || salesReturn.customer.email;
  if (!to) return { sent: false, reason: "no_email" };

  try {
    const lang = (salesReturn.company.language as Lang) ?? "ar";
    const pdfBuffer = await buildCreditNotePdfBuffer(tenantId, salesReturn);
    await sendCreditNoteEmail({
      to,
      customerName: salesReturn.customer.name,
      returnNumber: salesReturn.returnNumber,
      grandTotal: Number(salesReturn.grandTotal).toLocaleString(lang === "en" ? "en-US" : "ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      companyName: salesReturn.company.name,
      pdfBuffer,
      pdfFileName: `credit-note-${salesReturn.returnNumber}.pdf`,
      lang,
      currency: currencyLabel(salesReturn.company.currency, lang),
    });
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("فشل إرسال إيميل إشعار الدائن:", err);
    return { sent: false, reason: "send_failed" };
  }
}
