// أنواع مشتركة لبناء مستندات ZATCA UBL 2.1 (فاتورة/إشعار دائن/إشعار مدين) — مستقلة عن نماذج
// Prisma عمداً، حتى يبقى xmlBuilder.ts قابلاً للاختبار بمعزل عن قاعدة البيانات، ويستدعيه كل من
// salesInvoices/salesReturns/salesDebitNotes بعد تحويل بياناته الخاصة لهذا الشكل الموحّد.

export type ZatcaDocumentKind = "invoice" | "credit_note" | "debit_note";
export type ZatcaInvoiceSubtype = "standard" | "simplified";
export type ZatcaTaxCategoryCode = "S" | "Z" | "E" | "O";

export interface ZatcaPartyInput {
  vatNumber?: string | null;
  crNumber?: string | null;
  registrationName: string;
  street?: string | null;
  buildingNumber?: string | null;
  citySubdivision?: string | null;
  city?: string | null;
  postalZone?: string | null;
  countryCode?: string;
}

export interface ZatcaLineInput {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  /** صافي السطر بعد الخصم وقبل الضريبة (تُحسَب مسبقاً بواسطة computeInvoiceLine الحالية) */
  lineSubtotal: number;
  /** قيمة الضريبة على هذا السطر (تُحسَب مسبقاً) */
  lineVat: number;
  taxCategoryCode: ZatcaTaxCategoryCode;
  /** نسبة الضريبة 0-100 — ذات معنى فقط عند taxCategoryCode === "S" */
  taxPercent: number;
  taxExemptionReasonCode?: string | null;
  taxExemptionReason?: string | null;
}

export interface ZatcaDocumentInput {
  kind: ZatcaDocumentKind;
  subtype: ZatcaInvoiceSubtype;
  /** الرقم التسلسلي القابل للقراءة (invoiceNumber/returnNumber/debitNoteNumber) */
  id: string;
  uuid: string;
  /** بصيغة YYYY-MM-DD */
  issueDate: string;
  /** بصيغة HH:mm:ss */
  issueTime: string;
  icv: number;
  /** تجزئة المستند السابق في سلسلة الشركة، أو ثابت "أول فاتورة" إن كان icv === 1 */
  previousInvoiceHash: string;
  /** رقم الفاتورة الأصلية المرتبطة — إلزامي لإشعار دائن/مدين */
  billingReferenceId?: string;
  /** سبب إصدار إشعار الدائن/المدين (KSA-10) — إلزامي لإشعار دائن/مدين (BR-KSA-17)، بلا معنى
   * للفاتورة العادية. راجع buildPaymentMeansXml في xmlBuilder.ts لموضعه في XML. */
  issuanceReason?: string;
  seller: ZatcaPartyInput;
  /** إلزامي للفاتورة القياسية (standard)، يُترك فارغاً للمبسّطة (simplified) */
  buyer?: ZatcaPartyInput;
  lines: ZatcaLineInput[];
}

// أول فاتورة في سلسلة الشركة (icv=1) لا يوجد لها مستند سابق فعلي — القيمة الثابتة الموثّقة من
// زاتكا: base64(hex(sha256("0"))) — تحقّقنا منها حسابياً (انظر hash.test.ts) بدل افتراضها فقط.
export const ZATCA_FIRST_INVOICE_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";
