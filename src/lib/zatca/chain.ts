import { Prisma } from "@prisma/client";
import { buildDocumentXml } from "./xmlBuilder";
import { computeDocumentHash } from "./hash";
import { ZATCA_FIRST_INVOICE_PIH, ZatcaDocumentInput, ZatcaDocumentKind, ZatcaInvoiceSubtype, ZatcaLineInput, ZatcaPartyInput } from "./types";

type Tx = Prisma.TransactionClient;

export interface ZatcaCompanyLike {
  id: string;
  zatcaOnboardingStatus: string;
  zatcaEnvironment: string;
  zatcaLastInvoiceHash: string | null;
  name: string;
  vatNumber: string | null;
  crNumber: string | null;
  addressStreet: string | null;
  addressBuilding: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
}

export interface ZatcaCustomerLike {
  customerType: string;
  vatNumber: string | null;
  crNumber: string | null;
  name: string;
  street: string | null;
  buildingNo: string | null;
  district: string | null;
  city: string | null;
  postalCode: string | null;
}

export interface ZatcaPersistedLineLike {
  description: string | null;
  quantity: Prisma.Decimal | number;
  unitPrice: Prisma.Decimal | number;
  subtotal: Prisma.Decimal | number;
  vat: Prisma.Decimal | number;
  taxCategoryCode: string;
  taxExemptionReason: string | null;
}

export interface ZatcaChainResult {
  icv: number;
  previousInvoiceHash: string;
  invoiceHash: string;
  issuedAt: Date;
  zatcaStatus: "pending_clearance" | "pending_reporting";
  /** XML غير موقّع لهذا المستند بالضبط — يُعاد استخدامه في المرحلة E (التوقيع + الإرسال) بدل إعادة
   * بنائه، حتى تبقى التجزئة والمحتوى المُرسَل مضمونَي التطابق دائماً. */
  xml: string;
  subtype: ZatcaInvoiceSubtype;
}

interface ReserveZatcaChainParams {
  company: ZatcaCompanyLike;
  customer: ZatcaCustomerLike;
  kind: ZatcaDocumentKind;
  documentNumber: string;
  documentUuid: string;
  billingReferenceId?: string;
  lines: ZatcaPersistedLineLike[];
}

function mapCompanyToSeller(company: ZatcaCompanyLike): ZatcaPartyInput {
  return {
    vatNumber: company.vatNumber,
    crNumber: company.crNumber,
    registrationName: company.name,
    street: company.addressStreet,
    buildingNumber: company.addressBuilding,
    citySubdivision: company.addressDistrict,
    city: company.addressCity,
    postalZone: company.addressPostalCode,
  };
}

function mapCustomerToBuyer(customer: ZatcaCustomerLike): ZatcaPartyInput {
  return {
    vatNumber: customer.vatNumber,
    crNumber: customer.crNumber,
    registrationName: customer.name,
    street: customer.street,
    buildingNumber: customer.buildingNo,
    citySubdivision: customer.district,
    city: customer.city,
    postalZone: customer.postalCode,
  };
}

function subtypeForCustomer(customer: ZatcaCustomerLike): "standard" | "simplified" {
  return customer.customerType === "business" && Boolean(customer.vatNumber) ? "standard" : "simplified";
}

/** حقول QR 1-5 (النصية) من بيانات الشركة والمبلغ الإجمالي — لاستخدامها في المرحلة E عند بناء QR الكامل الموقّع */
export function buildQrBaseParams(company: ZatcaCompanyLike, issuedAt: Date, grandTotal: number, vatTotal: number) {
  return {
    sellerName: company.name,
    sellerVat: company.vatNumber || "",
    isoTimestamp: issuedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    invoiceTotal: grandTotal,
    vatTotal,
  };
}

export function mapPersistedLineToZatcaLine(line: ZatcaPersistedLineLike, index: number): ZatcaLineInput {
  const subtotal = Number(line.subtotal);
  const vat = Number(line.vat);
  const isStandardRated = line.taxCategoryCode === "S";
  // نسبة الضريبة تُشتق من المبلغ الفعلي المُخزَّن (لا من ثابت) حتى تبقى متّسقة مع ما حُسِب فعلاً
  // على هذا السطر تحديداً وقت الإنشاء (computeInvoiceLine)، لا افتراض نسبة موحّدة لكل الأصناف.
  const taxPercent = isStandardRated && subtotal > 0 ? Math.round((vat / subtotal) * 10000) / 100 : isStandardRated ? 15 : 0;
  return {
    id: String(index + 1),
    name: line.description || `سطر ${index + 1}`,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    lineSubtotal: subtotal,
    lineVat: vat,
    taxCategoryCode: line.taxCategoryCode as ZatcaLineInput["taxCategoryCode"],
    taxPercent,
    taxExemptionReason: line.taxExemptionReason,
  };
}

/**
 * يحجز رقم ICV التالي لهذه الشركة، يبني XML غير موقّع لهذا المستند (سيُوقَّع لاحقاً في المرحلة C
 * دون أن يغيّر ذلك تجزئته — QR/التوقيع يُستبعَدان من الحساب أصلاً)، يحسب تجزئته، ثم يحدّث
 * Company.zatcaLastInvoiceHash ذرّياً ضمن نفس المعاملة — كل هذا فقط إن كانت الشركة قد أكملت ربط
 * زاتكا فعلياً (zatcaOnboardingStatus !== "not_onboarded"). خلاف ذلك يُرجع null بلا أي أثر جانبي:
 * سلسلة التجزئة تُبنى فقط للأمام من لحظة الربط الفعلي، لا رجعياً على فواتير سابقة (لا يمكن إدراج
 * حلقة في سلسلة تجزئة بعد فوات الأوان).
 */
export async function reserveZatcaChain(tx: Tx, params: ReserveZatcaChainParams): Promise<ZatcaChainResult | null> {
  if (params.company.zatcaOnboardingStatus === "not_onboarded") return null;

  const rows = await tx.$queryRaw<{ zatcaNextIcv: number }[]>`
    UPDATE "companies" SET "zatcaNextIcv" = "zatcaNextIcv" + 1
    WHERE "id" = ${params.company.id}
    RETURNING "zatcaNextIcv" - 1 AS "zatcaNextIcv"
  `;
  const icv = rows[0]?.zatcaNextIcv;
  if (icv == null) throw new Error("تعذّر حجز رقم ICV — الشركة غير موجودة");

  const previousInvoiceHash = params.company.zatcaLastInvoiceHash || ZATCA_FIRST_INVOICE_PIH;
  const issuedAt = new Date();
  const subtype = subtypeForCustomer(params.customer);

  const documentInput: ZatcaDocumentInput = {
    kind: params.kind,
    subtype,
    id: params.documentNumber,
    uuid: params.documentUuid,
    issueDate: issuedAt.toISOString().slice(0, 10),
    issueTime: issuedAt.toISOString().slice(11, 19),
    icv,
    previousInvoiceHash,
    billingReferenceId: params.billingReferenceId,
    seller: mapCompanyToSeller(params.company),
    buyer: subtype === "standard" ? mapCustomerToBuyer(params.customer) : undefined,
    lines: params.lines.map(mapPersistedLineToZatcaLine),
  };

  const xml = buildDocumentXml(documentInput);
  const invoiceHash = computeDocumentHash(xml);

  await tx.company.update({ where: { id: params.company.id }, data: { zatcaLastInvoiceHash: invoiceHash } });

  return {
    icv,
    previousInvoiceHash,
    invoiceHash,
    issuedAt,
    zatcaStatus: subtype === "standard" ? "pending_clearance" : "pending_reporting",
    xml,
    subtype,
  };
}

export interface RebuildZatcaDocumentXmlParams {
  company: ZatcaCompanyLike;
  customer: ZatcaCustomerLike;
  kind: ZatcaDocumentKind;
  documentNumber: string;
  documentUuid: string;
  billingReferenceId?: string;
  lines: ZatcaPersistedLineLike[];
  /** icv/previousInvoiceHash/issuedAt محجوزة بالفعل من محاولة ترحيل سابقة — لا تُحجَز هنا من جديد */
  icv: number;
  previousInvoiceHash: string;
  issuedAt: Date;
}

export interface RebuiltZatcaDocument {
  xml: string;
  invoiceHash: string;
  subtype: ZatcaInvoiceSubtype;
}

/**
 * يعيد بناء XML غير موقّع طبق الأصل لمستند سبق حجز مكانه في السلسلة (icv/previousInvoiceHash/
 * issuedAt مُخزَّنة بالفعل على المستند من محاولة الترحيل الأصلية) — يُستخدَم فقط لإعادة محاولة
 * إرسال (Resend) مستند رفضته زاتكا سابقاً، بلا حجز أي رقم ICV جديد ولا أي أثر جانبي على السلسلة
 * (بعكس reserveZatcaChain أعلاه). المستدعي مسؤول عن مقارنة invoiceHash الناتج هنا بالقيمة
 * المخزَّنة أصلاً قبل إعادة الإرسال — أي فرق يعني أن بيانات المستند تغيّرت منذ الترحيل الأصلي.
 */
export function rebuildZatcaDocumentXml(params: RebuildZatcaDocumentXmlParams): RebuiltZatcaDocument {
  const subtype = subtypeForCustomer(params.customer);

  const documentInput: ZatcaDocumentInput = {
    kind: params.kind,
    subtype,
    id: params.documentNumber,
    uuid: params.documentUuid,
    issueDate: params.issuedAt.toISOString().slice(0, 10),
    issueTime: params.issuedAt.toISOString().slice(11, 19),
    icv: params.icv,
    previousInvoiceHash: params.previousInvoiceHash,
    billingReferenceId: params.billingReferenceId,
    seller: mapCompanyToSeller(params.company),
    buyer: subtype === "standard" ? mapCustomerToBuyer(params.customer) : undefined,
    lines: params.lines.map(mapPersistedLineToZatcaLine),
  };

  const xml = buildDocumentXml(documentInput);
  const invoiceHash = computeDocumentHash(xml);
  return { xml, invoiceHash, subtype };
}
