import invoiceTemplate, { buyerPartyTemplate, billingReferenceTemplate } from "./templates/invoiceTemplate";
import { ZatcaDocumentInput, ZatcaLineInput, ZatcaPartyInput } from "./types";

// بناء XML بصيغة UBL 2.1 لمستند فوترة إلكترونية (فاتورة/إشعار دائن/إشعار مدين) وفق زاتكا، من
// بيانات مُطبَّعة (ZatcaDocumentInput) مستقلة عن Prisma. غير موقّع بعد (UBLExtensions/Signature/QR
// تبقى فارغة/عنصر نائب — تُملأ في المرحلة C بعد حساب تجزئة هذا XML نفسه).

function escapeXml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** يقصّ الرقم لعدد منازل عشري محدد دون تقريب (مطابق toFixedNoRounding في المرجع) — زاتكا يرفض
 * فواتير تحتوي مبالغ مُقرَّبة تختلف عن المجموع الفعلي لبنودها بأكثر من هامش صغير جداً. */
function truncateDecimals(num: number, digits = 2): string {
  const re = new RegExp("^-?\\d+(?:\\.\\d{0," + digits + "})?");
  const match = num.toString().match(re);
  if (!match || !match.length) return (0).toFixed(digits);
  const matched = match[0];
  const dotIndex = matched.indexOf(".");
  if (dotIndex === -1) return `${matched}.${"0".repeat(digits)}`;
  const missing = digits - (matched.length - dotIndex) + 1;
  return missing > 0 ? matched + "0".repeat(missing) : matched;
}

function invoiceTypeCodeText(kind: ZatcaDocumentInput["kind"]): string {
  if (kind === "credit_note") return "381";
  if (kind === "debit_note") return "383";
  return "388";
}

/** أول رقمين: "01" قياسية أو "02" مبسّطة؛ باقي الأرقام أعلام (طرف ثالث/اسمية/تصدير/تلخيصية/
 * ذاتية الفوترة) — كلها صفر، لا يدعم نظامنا الحالي أياً منها. */
function invoiceTypeNameAttr(subtype: ZatcaDocumentInput["subtype"]): string {
  return subtype === "standard" ? "0100000" : "0200000";
}

function profileId(subtype: ZatcaDocumentInput["subtype"]): string {
  return subtype === "standard" ? "clearance:1.0" : "reporting:1.0";
}

function buildSupplierPlaceholders(seller: ZatcaPartyInput): Record<string, string> {
  return {
    SET_COMMERCIAL_REGISTRATION_NUMBER: escapeXml(seller.crNumber),
    SET_STREET_NAME: escapeXml(seller.street),
    SET_BUILDING_NUMBER: escapeXml(seller.buildingNumber),
    SET_PLOT_IDENTIFICATION: "0000",
    SET_CITY_SUBDIVISION: escapeXml(seller.citySubdivision),
    SET_CITY: escapeXml(seller.city),
    SET_POSTAL_NUMBER: escapeXml(seller.postalZone),
    SET_VAT_NUMBER: escapeXml(seller.vatNumber),
    SET_VAT_NAME: escapeXml(seller.registrationName),
  };
}

function buildBuyerBlock(buyer: ZatcaPartyInput | undefined): string {
  if (!buyer) return "<cac:AccountingCustomerParty></cac:AccountingCustomerParty>";
  return buyerPartyTemplate
    .replace("SET_BUYER_CRN", escapeXml(buyer.crNumber))
    .replace("SET_BUYER_STREET_NAME", escapeXml(buyer.street))
    .replace("SET_BUYER_BUILDING_NUMBER", escapeXml(buyer.buildingNumber))
    .replace("SET_BUYER_CITY_SUBDIVISION", escapeXml(buyer.citySubdivision))
    .replace("SET_BUYER_CITY", escapeXml(buyer.city))
    .replace("SET_BUYER_POSTAL_NUMBER", escapeXml(buyer.postalZone))
    .replace("SET_BUYER_COUNTRY", escapeXml(buyer.countryCode || "SA"))
    .replace("SET_BUYER_VAT_NUMBER", escapeXml(buyer.vatNumber))
    .replace("SET_BUYER_NAME", escapeXml(buyer.registrationName));
}

function buildBillingReference(billingReferenceId: string | undefined): string {
  if (!billingReferenceId) return "";
  return billingReferenceTemplate.replace("SET_BILLING_REFERENCE_ID", escapeXml(billingReferenceId));
}

function buildInvoiceLineXml(line: ZatcaLineInput): string {
  const isStandardRated = line.taxCategoryCode === "S";
  const percentXml = isStandardRated ? `\n          <cbc:Percent>${truncateDecimals(line.taxPercent)}</cbc:Percent>` : "";
  return `    <cac:InvoiceLine>
      <cbc:ID>${escapeXml(line.id)}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="PCE">${line.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="SAR">${truncateDecimals(line.lineSubtotal)}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${truncateDecimals(line.lineVat)}</cbc:TaxAmount>
        <cbc:RoundingAmount currencyID="SAR">${truncateDecimals(line.lineSubtotal + line.lineVat)}</cbc:RoundingAmount>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Name>${escapeXml(line.name)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${line.taxCategoryCode}</cbc:ID>${percentXml}
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="SAR">${truncateDecimals(line.unitPrice, 4)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
}

interface TaxGroup {
  taxCategoryCode: string;
  taxPercent: number;
  taxExemptionReason?: string | null;
  taxableAmount: number;
  taxAmount: number;
}

function groupLinesByTaxCategory(lines: ZatcaLineInput[]): TaxGroup[] {
  const groups = new Map<string, TaxGroup>();
  for (const line of lines) {
    const key = `${line.taxCategoryCode}:${line.taxPercent}`;
    const existing = groups.get(key);
    if (existing) {
      existing.taxableAmount += line.lineSubtotal;
      existing.taxAmount += line.lineVat;
    } else {
      groups.set(key, {
        taxCategoryCode: line.taxCategoryCode,
        taxPercent: line.taxPercent,
        taxExemptionReason: line.taxExemptionReason,
        taxableAmount: line.lineSubtotal,
        taxAmount: line.lineVat,
      });
    }
  }
  return [...groups.values()];
}

function buildTaxTotalXml(lines: ZatcaLineInput[], totalVat: number): string {
  const groups = groupLinesByTaxCategory(lines);
  const subtotalsXml = groups
    .map((g) => {
      const exemptionXml =
        g.taxCategoryCode !== "S" && g.taxExemptionReason
          ? `\n        <cbc:TaxExemptionReason>${escapeXml(g.taxExemptionReason)}</cbc:TaxExemptionReason>`
          : "";
      return `      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="SAR">${truncateDecimals(g.taxableAmount)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="SAR">${truncateDecimals(g.taxAmount)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${g.taxCategoryCode}</cbc:ID>
          <cbc:Percent>${truncateDecimals(g.taxPercent)}</cbc:Percent>${exemptionXml}
          <cac:TaxScheme>
            <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`;
    })
    .join("\n");

  // عنصرا cac:TaxTotal مكرَّران عمداً على مستوى المستند — الأول يحمل تفصيل TaxSubtotal لكل فئة
  // ضريبية، والثاني ملخّص بلا تفصيل (قاعدة خاصة بملف زاتكا KSA، مُقتبَسة من التطبيق المرجعي).
  return `  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${truncateDecimals(totalVat)}</cbc:TaxAmount>
${subtotalsXml}
  </cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${truncateDecimals(totalVat)}</cbc:TaxAmount>
  </cac:TaxTotal>`;
}

function buildLegalMonetaryTotalXml(subtotal: number, totalVat: number): string {
  const grandTotal = subtotal + totalVat;
  return `  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${truncateDecimals(subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">${truncateDecimals(subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${truncateDecimals(grandTotal)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>
    <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="SAR">${truncateDecimals(grandTotal)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;
}

export function buildDocumentXml(input: ZatcaDocumentInput): string {
  if (input.subtype === "standard" && !input.buyer) {
    throw new Error("الفاتورة القياسية تتطلب بيانات المشتري (buyer)");
  }
  if ((input.kind === "credit_note" || input.kind === "debit_note") && !input.billingReferenceId) {
    throw new Error("إشعار الدائن/المدين يتطلب رقم الفاتورة المرتبطة (billingReferenceId)");
  }

  const totalVat = input.lines.reduce((sum, l) => sum + l.lineVat, 0);
  const subtotal = input.lines.reduce((sum, l) => sum + l.lineSubtotal, 0);

  let xml = invoiceTemplate;
  xml = xml.replace("SET_UBL_EXTENSIONS_STRING", "");
  xml = xml.replace("SET_PROFILE_ID", profileId(input.subtype));
  xml = xml.replace("SET_INVOICE_SERIAL_NUMBER", escapeXml(input.id));
  xml = xml.replace("SET_TERMINAL_UUID", escapeXml(input.uuid));
  xml = xml.replace("SET_ISSUE_DATE", input.issueDate);
  xml = xml.replace("SET_ISSUE_TIME", input.issueTime);
  xml = xml.replace("SET_INVOICE_TYPE_NAME", invoiceTypeNameAttr(input.subtype));
  xml = xml.replace("SET_INVOICE_TYPE", invoiceTypeCodeText(input.kind));
  xml = xml.replace("SET_BILLING_REFERENCE", buildBillingReference(input.billingReferenceId));
  xml = xml.replace("SET_INVOICE_COUNTER_NUMBER", String(input.icv));
  xml = xml.replace("SET_PREVIOUS_INVOICE_HASH", input.previousInvoiceHash);
  xml = xml.replace("SET_QR_CODE_DATA", "");

  const supplierPlaceholders = buildSupplierPlaceholders(input.seller);
  for (const [key, value] of Object.entries(supplierPlaceholders)) {
    xml = xml.replace(key, value);
  }

  xml = xml.replace("SET_ACCOUNTING_CUSTOMER_PARTY", buildBuyerBlock(input.buyer));
  xml = xml.replace("SET_TAX_TOTAL", buildTaxTotalXml(input.lines, totalVat));
  xml = xml.replace("SET_LEGAL_MONETARY_TOTAL", buildLegalMonetaryTotalXml(subtotal, totalVat));
  xml = xml.replace("SET_INVOICE_LINES", input.lines.map(buildInvoiceLineXml).join("\n"));

  // القالب يبدأ بسطر فارغ قبل إعلان <?xml...?> (لأسباب تنسيقية موروثة من التطبيق المرجعي) —
  // يجب أن يكون هذا الإعلان أول حرف في المستند فعلياً وإلا رفضته محلّلات XML الصارمة.
  return xml.trim();
}
