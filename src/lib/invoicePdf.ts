import QRCode from "qrcode";
import { buildInvoiceHtml, InvoicePdfData, InvoicePdfLine } from "./zatca/pdf/invoiceHtmlTemplate";
import { renderHtmlToPdf } from "./zatca/pdf/renderPdf";

export interface PlainInvoicePdfInput {
  invoiceNumber: string;
  date: Date;
  companyName: string;
  companyVatNumber?: string | null;
  companyAddress?: string | null;
  brandColor?: string | null;
  customerName: string;
  customerVatNumber?: string | null;
  lines: InvoicePdfLine[];
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  qrPayload?: string | null;
  zatcaUuid?: string | null;
}

/**
 * PDF بسيط لفاتورة مبيعات عادية (بلا ملف XML موقّع مُرفَق) لإرسالها بالإيميل — يستخدم نفس قالب
 * HTML الموحّد المستخدَم في PDF/A-3 الخاص بزاتكا (buildInvoiceHtml)، لكن دون تضمين XML، فيصلح
 * لأي فاتورة بصرف النظر عن حالة تفعيل زاتكا للشركة. الشعار غير مُضمَّن هنا (يتطلب جلب صورة عن
 * بُعد وتحويلها base64) — القالب يعرض بدلاً منه اسم الشركة نصياً، وهو سلوك القالب الافتراضي أصلاً.
 */
export async function buildPlainInvoicePdf(input: PlainInvoicePdfInput): Promise<Buffer> {
  const qrDataUrl = await QRCode.toDataURL(input.qrPayload || "", { margin: 1, width: 150 });

  const data: InvoicePdfData = {
    documentTitleAr: "فاتورة ضريبية",
    documentNumber: input.invoiceNumber,
    issueDate: input.date.toISOString().slice(0, 10),
    companyName: input.companyName,
    companyVatNumber: input.companyVatNumber,
    companyAddress: input.companyAddress,
    companyLogoDataUrl: null,
    brandColor: input.brandColor,
    customerName: input.customerName,
    customerVatNumber: input.customerVatNumber,
    lines: input.lines,
    subtotal: input.subtotal,
    vatTotal: input.vatTotal,
    grandTotal: input.grandTotal,
    qrDataUrl,
    zatcaUuid: input.zatcaUuid || "",
  };

  const html = buildInvoiceHtml(data);
  return renderHtmlToPdf(html);
}
