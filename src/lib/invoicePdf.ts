import QRCode from "qrcode";
import { buildInvoiceHtml, InvoicePdfData, InvoicePdfLine } from "./zatca/pdf/invoiceHtmlTemplate";
import { buildInvoiceHtmlClassicPro, ClassicProInvoiceLine, ClassicProBankAccount } from "./zatca/pdf/invoiceHtmlTemplateClassicPro";
import { renderHtmlToPdf } from "./zatca/pdf/renderPdf";

export interface PlainInvoicePdfInput {
  // قالب الفاتورة النشط لشركة هذه الفاتورة (Company.invoiceTemplate) — "modern" (الافتراضي،
  // القالب الحالي بلا أي تغيير) أو "classicPro" (القالب الجديد، انظر invoiceHtmlTemplateClassicPro.ts)
  template?: "modern" | "classicPro";
  invoiceNumber: string;
  date: Date;
  dueDate?: Date | null;
  customerReference?: string | null;
  poNumber?: string | null;
  salesperson?: string | null;
  otherId?: string | null;
  paymentMethod?: string | null;
  companyName: string;
  companyNameEn?: string | null;
  companyVatNumber?: string | null;
  companyCrNumber?: string | null;
  companyUnifiedEntityNumber?: string | null;
  companyLicenseNumber?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  brandColor?: string | null;
  branchName?: string | null;
  customerName: string;
  customerVatNumber?: string | null;
  customerUnifiedEntityNumber?: string | null;
  customerAddress?: string | null;
  lines: (InvoicePdfLine & Partial<ClassicProInvoiceLine>)[];
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  paidAmount?: number;
  qrPayload?: string | null;
  zatcaUuid?: string | null;
  bankAccounts?: ClassicProBankAccount[];
}

/**
 * PDF بسيط لفاتورة مبيعات عادية (بلا ملف XML موقّع مُرفَق) لإرسالها بالإيميل — يستخدم نفس قالب
 * HTML الموحّد المستخدَم في PDF/A-3 الخاص بزاتكا (buildInvoiceHtml)، لكن دون تضمين XML، فيصلح
 * لأي فاتورة بصرف النظر عن حالة تفعيل زاتكا للشركة. الشعار غير مُضمَّن هنا (يتطلب جلب صورة عن
 * بُعد وتحويلها base64) — القالب يعرض بدلاً منه اسم الشركة نصياً، وهو سلوك القالب الافتراضي أصلاً.
 */
export async function buildPlainInvoicePdf(input: PlainInvoicePdfInput): Promise<Buffer> {
  const qrDataUrl = await QRCode.toDataURL(input.qrPayload || "", { margin: 1, width: 150 });
  const issueDate = input.date.toISOString().slice(0, 10);

  if (input.template === "classicPro") {
    const data = {
      documentNumber: input.invoiceNumber,
      issueDate,
      dueDate: input.dueDate ? input.dueDate.toISOString().slice(0, 10) : null,
      customerReference: input.customerReference,
      poNumber: input.poNumber,
      salesperson: input.salesperson,
      otherId: input.otherId,
      paymentMethod: input.paymentMethod,
      companyName: input.companyName,
      companyNameEn: input.companyNameEn,
      companyLogoDataUrl: null,
      companyVatNumber: input.companyVatNumber,
      companyCrNumber: input.companyCrNumber,
      companyUnifiedEntityNumber: input.companyUnifiedEntityNumber,
      companyLicenseNumber: input.companyLicenseNumber,
      companyAddress: input.companyAddress,
      companyPhone: input.companyPhone,
      brandColor: input.brandColor,
      branchName: input.branchName,
      customerName: input.customerName,
      customerVatNumber: input.customerVatNumber,
      customerUnifiedEntityNumber: input.customerUnifiedEntityNumber,
      customerAddress: input.customerAddress,
      lines: input.lines.map((l) => ({
        description: l.description,
        itemCode: l.itemCode ?? null,
        unit: l.unit ?? null,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct ?? 0,
        subtotal: l.subtotal,
        vat: l.vat,
        total: l.total,
      })),
      subtotal: input.subtotal,
      vatTotal: input.vatTotal,
      grandTotal: input.grandTotal,
      paidAmount: input.paidAmount || 0,
      qrDataUrl,
      bankAccounts: input.bankAccounts || [],
    };
    return renderHtmlToPdf(buildInvoiceHtmlClassicPro(data));
  }

  const data: InvoicePdfData = {
    documentTitleAr: "فاتورة ضريبية",
    documentNumber: input.invoiceNumber,
    issueDate,
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

export interface PlainCreditNotePdfInput {
  returnNumber: string;
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
  // الفاتورة الأصلية (BillingReference) والسبب — كلاهما غائبان لإشعار داخلي بلا فاتورة مرتبطة
  // (راجع resolveBillingReferenceNumber في salesReturns.service.ts)، فيُعرَض المستند بلا هذين
  // السطرين فقط بدل رمي خطأ أو عرض حقول فارغة.
  billingReferenceNumber?: string | null;
  billingReferenceDate?: string | null; // YYYY-MM-DD
  reason?: string | null;
}

/**
 * PDF بسيط لإشعار دائن (بلا XML موقّع مُرفَق) — نفس أنبوب buildPlainInvoicePdf أعلاه بالضبط
 * (نفس buildInvoiceHtml وrenderHtmlToPdf)، فرق البيانات فقط: عنوان "إشعار دائن" بدل "فاتورة
 * ضريبية"، وسطرا الفاتورة الأصلية/السبب إن وُجدا. "بسيط" مؤقتاً بتصميم — راجع نفس ملاحظة
 * buildInvoicePdf.ts (PDF/A-3 مع XML مُضمَّن): هذا المسار حالياً غير مُفعَّل في أي تدفّق فعلي
 * (لا للفواتير ولا لإشعارات الدائن)؛ خطة لاحقة منفصلة تُفعِّله للاثنين معاً.
 */
export async function buildPlainCreditNotePdf(input: PlainCreditNotePdfInput): Promise<Buffer> {
  const qrDataUrl = await QRCode.toDataURL(input.qrPayload || "", { margin: 1, width: 150 });
  const data: InvoicePdfData = {
    documentTitleAr: "إشعار دائن",
    documentNumber: input.returnNumber,
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
    billingReference: input.billingReferenceNumber ? { number: input.billingReferenceNumber, date: input.billingReferenceDate || "" } : null,
    issuanceReason: input.reason || null,
  };

  return renderHtmlToPdf(buildInvoiceHtml(data));
}
