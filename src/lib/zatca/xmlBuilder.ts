import invoiceTemplate, { billingReferenceTemplate, paymentMeansTemplate } from "./templates/invoiceTemplate";
import { formatMoney, fromHalalas, toHalalas } from "../money";
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

/**
 * المبالغ: قاعدة تقريب واحدة (src/lib/money.ts) — خانتان، نصف للأعلى، وكل جمع بالهللات (أعداد صحيحة). لا قصّ إطلاقاً.
 * كان السطر يُقصّ (truncateDecimals) بينما يُقرَّب مجموعه (KSA-12) ويُقرَّب إجمالي الرأس من مجاميع غير مقرَّبة — فإن وصل
 * صافٍ بثلاث خانات (191.105) صار BT-109 = 191.11 وBT-112 = 219.77 (لأن 219.775 ثنائياً 219.77499…) ⇒ BR-CO-15 رفض،
 * ومعه BR-KSA-51 على السطر. الآن، بالبناء:
 *   KSA-12 = BT-131 + KSA-11 لكل سطر (BR-KSA-51)
 *   BT-109 = Σ BT-131 = Σ BT-116، BT-110 = Σ BT-117، BT-112 = BT-109 + BT-110 (BR-CO-15)
 *   BT-131 = BT-129 × BT-146 / BT-149 (BR-KSA-EN16931-11) — راجع linePrice أدناه.
 */
interface MoneyLine {
  line: ZatcaLineInput;
  netH: number;
  vatH: number;
}

function quantityTenThousandths(q: number): number {
  // الكمية مخزّنة Decimal(18, 4) — أربع خانات بالضبط
  return Math.round(q * 10000);
}

/**
 * BT-146 (سعر الوحدة الصافي) وBT-149 (أساس الكمية) بحيث BT-129 × BT-146 / BT-149 = BT-131 بالضبط (حساب عشري، كما تفحصه
 * زاتكا). السعر المُدخَل في الفاتورة قد يكون شاملاً للضريبة أو قبل الخصم — لا يصلح BT-146 (كان يُرسَل كما هو، فيفشل
 * BR-KSA-EN16931-11 لكل سطر بسعر شامل أو بخصم). نشتقّه من صافي السطر نفسه:
 * - إن وُجد سعر وحدة بأربع خانات يحقق الكمية × السعر = الصافي بالضبط ⇒ ذلك السعر، وأساس الكمية 1 (الحالة الشائعة).
 * - وإلا (191.30 لثلاث وحدات = 63.7666…) ⇒ السعر = الصافي كاملاً وأساس الكمية = الكمية نفسها: «سعر 3 وحدات 191.30».
 */
function linePrice(qty: number, netH: number): { price: string; baseQuantity: string | null } {
  const qT = quantityTenThousandths(qty);
  if (qT <= 0) return { price: formatMoney(fromHalalas(netH)), baseQuantity: null };
  // الصافي بوحدات 1e-8 (كمية 1e-4 × سعر 1e-4) = netH × 1e6
  const target = BigInt(netH) * 1000000n;
  if (target % BigInt(qT) === 0n) {
    const priceT = Number(target / BigInt(qT)); // سعر الوحدة بأجزاء العشرة آلاف
    return { price: formatTenThousandths(priceT), baseQuantity: null };
  }
  return { price: formatMoney(fromHalalas(netH)), baseQuantity: formatQuantity(qty) };
}

/** سعر بأجزاء العشرة آلاف ⇒ نص بخانتين على الأقل وحتى أربع عند الحاجة: 637700 ⇒ "63.77"، 637681 ⇒ "63.7681" */
function formatTenThousandths(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const frac = String(abs % 10000).padStart(4, "0");
  const shown = frac.slice(0, 2) + frac.slice(2).replace(/0+$/, "");
  return `${sign}${Math.floor(abs / 10000)}.${shown}`;
}

function formatQuantity(q: number): string {
  const t = quantityTenThousandths(q);
  const whole = Math.floor(t / 10000);
  const frac = String(t % 10000).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

function formatPercent(p: number): string {
  return (Math.round(p * 100) / 100).toFixed(2);
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

// "reporting:1.0" للنوعين — راجع تعليق profileId في xmlBuilderV1.ts لتاريخ هذا الحقل.
function profileId(): string {
  return "reporting:1.0";
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

/**
 * المشتري. الرقم الضريبي مكانه BT-48 (PartyTaxScheme/CompanyID) وحده. BT-46 (PartyIdentification) لمعرّف آخر بمخطط صالح —
 * كان يُرسَل فيه الرقم الضريبي نفسه بـschemeID="TIN" فتحذّر زاتكا BR-KSA-F-07. الآن: BT-46 = رقم السجل التجاري (CRN) إن وُجد،
 * ولا يُرسَل أصلاً إن لم يوجد. مشترٍ بلا رقم ضريبي ولا سجل تجاري لا يُبنى له مستند قياسي.
 */
function buildBuyerBlock(buyer: ZatcaPartyInput | undefined): string {
  if (!buyer) return "<cac:AccountingCustomerParty></cac:AccountingCustomerParty>";
  if (!buyer.vatNumber && !buyer.crNumber) {
    throw new Error("لا يمكن تحديد هوية المشتري لزاتكا — لا يوجد رقم ضريبي (VAT) ولا رقم سجل تجاري (CRN) مسجَّل لهذا العميل");
  }
  const identification = buyer.crNumber
    ? `
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${escapeXml(buyer.crNumber)}</cbc:ID>
      </cac:PartyIdentification>`
    : "";
  const taxScheme = buyer.vatNumber
    ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(buyer.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
    : "";
  return `<cac:AccountingCustomerParty>
    <cac:Party>${identification}
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(buyer.street)}</cbc:StreetName>
        <cbc:BuildingNumber>${escapeXml(buyer.buildingNumber)}</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>${escapeXml(buyer.citySubdivision)}</cbc:CitySubdivisionName>
        <cbc:CityName>${escapeXml(buyer.city)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(buyer.postalZone)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(buyer.countryCode || "SA")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>${taxScheme}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(buyer.registrationName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;
}

function buildBillingReference(billingReferenceId: string | undefined): string {
  if (!billingReferenceId) return "";
  return billingReferenceTemplate.replace("SET_BILLING_REFERENCE_ID", escapeXml(billingReferenceId));
}

/**
 * KSA-5 (تاريخ التوريد، BT-72 ActualDeliveryDate) — يُكتَب فقط عند إعادة إصدار مستند قياسي مرفوض (supplyDate مُعرَّف)،
 * بموضعه في UBL بين AccountingCustomerParty وPaymentMeans. غيابه لا يُنتِج أي شيء، فكل مستند آخر يبقى بايتاته كما كانت.
 */
function buildDeliveryXml(supplyDate: string | undefined): string {
  if (!supplyDate) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(supplyDate)) throw new Error(`تاريخ التوريد (KSA-5) بصيغة غير صالحة: ${supplyDate}`);
  return `<cac:Delivery>
    <cbc:ActualDeliveryDate>${supplyDate}</cbc:ActualDeliveryDate>
  </cac:Delivery>
  `;
}

/**
 * BR-KSA-17: سبب إصدار إشعار الدائن/المدين (KSA-10) إلزامي لهذين النوعين تحديداً (388/الفاتورة
 * العادية لا تحتاجه إطلاقاً).
 */
function buildPaymentMeansXml(kind: ZatcaDocumentInput["kind"], issuanceReason: string | undefined): string {
  if (kind === "invoice" || !issuanceReason) return "";
  return paymentMeansTemplate.replace("SET_INSTRUCTION_NOTE", escapeXml(issuanceReason));
}

function buildInvoiceLineXml({ line, netH, vatH }: MoneyLine): string {
  const isStandardRated = line.taxCategoryCode === "S";
  const percentXml = isStandardRated ? `\n          <cbc:Percent>${formatPercent(line.taxPercent)}</cbc:Percent>` : "";
  const { price, baseQuantity } = linePrice(line.quantity, netH);
  const baseQuantityXml = baseQuantity ? `\n        <cbc:BaseQuantity unitCode="PCE">${baseQuantity}</cbc:BaseQuantity>` : "";
  return `    <cac:InvoiceLine>
      <cbc:ID>${escapeXml(line.id)}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="PCE">${formatQuantity(line.quantity)}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="SAR">${formatMoney(fromHalalas(netH))}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${formatMoney(fromHalalas(vatH))}</cbc:TaxAmount>
        <cbc:RoundingAmount currencyID="SAR">${formatMoney(fromHalalas(netH + vatH))}</cbc:RoundingAmount>
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
        <cbc:PriceAmount currencyID="SAR">${price}</cbc:PriceAmount>${baseQuantityXml}
      </cac:Price>
    </cac:InvoiceLine>`;
}

interface TaxGroup {
  taxCategoryCode: string;
  taxPercent: number;
  taxExemptionReason?: string | null;
  taxExemptionReasonCode?: string | null;
  taxableH: number;
  taxH: number;
}

function groupLinesByTaxCategory(lines: MoneyLine[]): TaxGroup[] {
  const groups = new Map<string, TaxGroup>();
  for (const { line, netH, vatH } of lines) {
    const key = `${line.taxCategoryCode}:${formatPercent(line.taxPercent)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.taxableH += netH;
      existing.taxH += vatH;
    } else {
      groups.set(key, {
        taxCategoryCode: line.taxCategoryCode,
        taxPercent: line.taxPercent,
        taxExemptionReason: line.taxExemptionReason,
        taxExemptionReasonCode: line.taxExemptionReasonCode,
        taxableH: netH,
        taxH: vatH,
      });
    }
  }
  return [...groups.values()];
}

function buildTaxTotalXml(groups: TaxGroup[], totalVatH: number): string {
  const subtotalsXml = groups
    .map((g) => {
      const exemptionXml =
        g.taxCategoryCode !== "S" && g.taxExemptionReason
          ? `\n        <cbc:TaxExemptionReason>${escapeXml(g.taxExemptionReason)}</cbc:TaxExemptionReason>`
          : "";
      return `      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="SAR">${formatMoney(fromHalalas(g.taxableH))}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="SAR">${formatMoney(fromHalalas(g.taxH))}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${g.taxCategoryCode}</cbc:ID>
          <cbc:Percent>${formatPercent(g.taxPercent)}</cbc:Percent>${g.taxCategoryCode !== "S" && g.taxExemptionReasonCode ? `<cbc:TaxExemptionReasonCode>${escapeXml(g.taxExemptionReasonCode)}</cbc:TaxExemptionReasonCode>` : ""}${exemptionXml}
          <cac:TaxScheme>
            <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`;
    })
    .join("\n");

  // عنصرا cac:TaxTotal مكرَّران عمداً على مستوى المستند — الأول يحمل تفصيل TaxSubtotal لكل فئة
  // ضريبية، والثاني ملخّص بلا تفصيل (قاعدة خاصة بملف زاتكا KSA، مُقتبَسة من التطبيق المرجعي).
  const totalVat = formatMoney(fromHalalas(totalVatH));
  return `  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${totalVat}</cbc:TaxAmount>
${subtotalsXml}
  </cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${totalVat}</cbc:TaxAmount>
  </cac:TaxTotal>`;
}

function buildLegalMonetaryTotalXml(netH: number, vatH: number): string {
  const net = formatMoney(fromHalalas(netH));
  const gross = formatMoney(fromHalalas(netH + vatH));
  return `  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${net}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">${net}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${gross}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>
    <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="SAR">${gross}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;
}

export function buildDocumentXml(input: ZatcaDocumentInput): string {
  if (input.subtype === "standard" && !input.buyer) {
    throw new Error("الفاتورة القياسية تتطلب بيانات المشتري (buyer)");
  }
  if ((input.kind === "credit_note" || input.kind === "debit_note") && !input.billingReferenceId) {
    throw new Error("إشعار الدائن/المدين يتطلب رقم الفاتورة المرتبطة (billingReferenceId)");
  }
  if ((input.kind === "credit_note" || input.kind === "debit_note") && !input.issuanceReason) {
    // BR-KSA-17: إلزامي لهذين النوعين فقط — راجع buildPaymentMeansXml أعلاه.
    throw new Error("إشعار الدائن/المدين يتطلب سبب الإصدار (issuanceReason) — BR-KSA-17");
  }

  // كل مبلغ سطر يُقرَّب مرة واحدة هنا (لا يُفترض أن المستدعي قرّبه)، والباقي جمع بالهللات
  const moneyLines: MoneyLine[] = input.lines.map((line) => ({ line, netH: toHalalas(line.lineSubtotal), vatH: toHalalas(line.lineVat) }));
  const groups = groupLinesByTaxCategory(moneyLines);
  const netH = groups.reduce((s, g) => s + g.taxableH, 0);
  const vatH = groups.reduce((s, g) => s + g.taxH, 0);

  let xml = invoiceTemplate;
  xml = xml.replace("SET_UBL_EXTENSIONS_STRING", "");
  xml = xml.replace("SET_PROFILE_ID", profileId());
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
  xml = xml.replace("SET_PAYMENT_MEANS", buildDeliveryXml(input.supplyDate) + buildPaymentMeansXml(input.kind, input.issuanceReason));
  xml = xml.replace("SET_TAX_TOTAL", buildTaxTotalXml(groups, vatH));
  xml = xml.replace("SET_LEGAL_MONETARY_TOTAL", buildLegalMonetaryTotalXml(netH, vatH));
  xml = xml.replace("SET_INVOICE_LINES", moneyLines.map(buildInvoiceLineXml).join("\n"));

  // القالب يبدأ بسطر فارغ قبل إعلان <?xml...?> (لأسباب تنسيقية موروثة من التطبيق المرجعي) —
  // يجب أن يكون هذا الإعلان أول حرف في المستند فعلياً وإلا رفضته محلّلات XML الصارمة.
  return xml.trim();
}
