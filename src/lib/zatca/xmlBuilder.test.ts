import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { buildDocumentXml } from "./xmlBuilder";
import { ZATCA_FIRST_INVOICE_PIH, ZatcaDocumentInput } from "./types";

const SELLER = {
  vatNumber: "300000000000003",
  crNumber: "1010101010",
  registrationName: "شركة أثر التجريبية",
  street: "طريق الملك فهد",
  buildingNumber: "1234",
  citySubdivision: "العليا",
  city: "الرياض",
  postalZone: "12345",
};

const BUYER = {
  vatNumber: "300000000000010",
  crNumber: "2020202020",
  registrationName: "شركة العميل التجريبية",
  street: "شارع التحلية",
  buildingNumber: "5678",
  citySubdivision: "الروضة",
  city: "جدة",
  postalZone: "54321",
};

function base(overrides: Partial<ZatcaDocumentInput> = {}): ZatcaDocumentInput {
  return {
    kind: "invoice",
    subtype: "simplified",
    id: "INV-00001",
    uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
    issueDate: "2026-08-01",
    issueTime: "10:00:00",
    icv: 1,
    previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH,
    seller: SELLER,
    lines: [
      { id: "1", name: "خدمة استشارية", quantity: 1, unitPrice: 100, lineSubtotal: 100, lineVat: 15, taxCategoryCode: "S", taxPercent: 15 },
    ],
    ...overrides,
  };
}

function parse(xml: string) {
  return new DOMParser().parseFromString(xml, "text/xml");
}

describe("buildDocumentXml", () => {
  it("produces well-formed, parseable XML", () => {
    const xml = buildDocumentXml(base());
    const doc = parse(xml);
    expect(doc.documentElement!.tagName).toBe("Invoice");
  });

  // BR-KSA-EN16931-01 (BT-23): زاتكا رفضت فعلياً "clearance:1.0"، ثم "standard:1.0"، ثم "1.0"
  // المجرَّدة — كل واحدة استُنتِجت من رسالة رفض عربية مشوَّهة نحوياً كانت تُسقِط الكلمة الفعلية.
  // طلب الرسالة بالإنجليزية (Accept-Language: en أثناء التشخيص) حسم الأمر بنص واضح: القيمة
  // الصحيحة هي "reporting:1.0" للفاتورتين معاً، بلا فرق بحسب subtype.
  it("uses profile id 'reporting:1.0' and 0200000 type name for simplified invoices, no buyer block content", () => {
    const xml = buildDocumentXml(base({ subtype: "simplified" }));
    expect(xml).toContain("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>");
    expect(xml).toContain('name="0200000"');
    expect(xml).toContain(">388<");
    expect(xml).toContain("<cac:AccountingCustomerParty></cac:AccountingCustomerParty>");
  });

  it("uses profile id 'reporting:1.0', 0100000 type name, and full buyer block for standard invoices", () => {
    const xml = buildDocumentXml(base({ subtype: "standard", buyer: BUYER }));
    expect(xml).toContain("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>");
    expect(xml).toContain('name="0100000"');
    expect(xml).toContain(BUYER.registrationName);
    expect(xml).toContain(BUYER.vatNumber);
  });

  it("throws if a standard invoice is built without buyer data", () => {
    expect(() => buildDocumentXml(base({ subtype: "standard" }))).toThrow();
  });

  // BR-KSA-14: عطل إنتاج فعلي مؤكَّد (BR-KSA-F-08 "Please recheck the CRN value") — كان الكود
  // يضع دائماً schemeID="CRN" حتى حين لا يوجد رقم سجل تجاري للمشتري، فتصل زاتكا وسماً "CRN" بقيمة
  // فارغة بدل استخدام الرقم الضريبي (TIN) الفعلي المتوفر، رغم أن BR-KSA-14 يشترط استخدام أيّ معرِّف
  // متوفر فعلياً بترتيب أولوية زاتكا (TIN قبل CRN).
  it("identifies the buyer by TIN (vatNumber) per BR-KSA-14 priority, even when a crNumber also exists", () => {
    const xml = buildDocumentXml(base({ subtype: "standard", buyer: BUYER }));
    expect(xml).toContain(`<cbc:ID schemeID="TIN">${BUYER.vatNumber}</cbc:ID>`);
    // البائع يستمر على CRN كالمعتاد (BR-KSA-08) — الفحص هنا يستهدف كتلة المشتري تحديداً.
    const buyerBlock = xml.slice(xml.indexOf("<cac:AccountingCustomerParty"));
    expect(buyerBlock).not.toContain('schemeID="CRN"');
  });

  it("falls back to CRN when the buyer has no VAT number", () => {
    const xml = buildDocumentXml(base({ subtype: "standard", buyer: { ...BUYER, vatNumber: null } }));
    expect(xml).toContain(`<cbc:ID schemeID="CRN">${BUYER.crNumber}</cbc:ID>`);
  });

  it("throws if the buyer has neither a VAT number nor a CR number", () => {
    expect(() => buildDocumentXml(base({ subtype: "standard", buyer: { ...BUYER, vatNumber: null, crNumber: null } }))).toThrow();
  });

  it("uses invoice type code 381 for credit notes and 383 for debit notes, with a billing reference", () => {
    const credit = buildDocumentXml(base({ kind: "credit_note", billingReferenceId: "INV-00001", issuanceReason: "سبب الإصدار" }));
    expect(credit).toContain(">381<");
    expect(credit).toContain("<cac:BillingReference>");
    expect(credit).toContain("INV-00001");

    const debit = buildDocumentXml(base({ kind: "debit_note", billingReferenceId: "INV-00001", issuanceReason: "سبب الإصدار" }));
    expect(debit).toContain(">383<");
  });

  it("throws if a credit/debit note is built without a billing reference", () => {
    expect(() => buildDocumentXml(base({ kind: "credit_note", issuanceReason: "سبب الإصدار" }))).toThrow();
    expect(() => buildDocumentXml(base({ kind: "debit_note", issuanceReason: "سبب الإصدار" }))).toThrow();
  });

  // BR-KSA-17 (KSA-10): زاتكا قبلت المرجع الذاتي الاصطناعي بلا اعتراض وكشفت هذا الحقل الوحيد
  // المتبقي — إلزامي لإشعار الدائن/المدين فقط، لا الفاتورة العادية.
  it("throws if a credit/debit note is built without an issuance reason (BR-KSA-17)", () => {
    expect(() => buildDocumentXml(base({ kind: "credit_note", billingReferenceId: "INV-00001" }))).toThrow();
    expect(() => buildDocumentXml(base({ kind: "debit_note", billingReferenceId: "INV-00001" }))).toThrow();
  });

  it("emits the issuance reason as cac:PaymentMeans/cbc:InstructionNote, positioned after AccountingCustomerParty and before TaxTotal, for credit/debit notes only", () => {
    const credit = buildDocumentXml(base({ kind: "credit_note", billingReferenceId: "INV-00001", issuanceReason: "سلعة تالفة" }));
    expect(credit).toContain("<cac:PaymentMeans>");
    expect(credit).toContain("<cbc:InstructionNote>سلعة تالفة</cbc:InstructionNote>");
    const customerPartyPos = credit.indexOf("<cac:AccountingCustomerParty");
    const paymentMeansPos = credit.indexOf("<cac:PaymentMeans>");
    const taxTotalPos = credit.indexOf("<cac:TaxTotal>");
    expect(customerPartyPos).toBeLessThan(paymentMeansPos);
    expect(paymentMeansPos).toBeLessThan(taxTotalPos);

    // الفاتورة العادية لا تحتاج هذا العنصر إطلاقاً، حتى لو مُرِّرت issuanceReason خطأً.
    const invoice = buildDocumentXml(base({ kind: "invoice", issuanceReason: "لا معنى له هنا" }));
    expect(invoice).not.toContain("<cac:PaymentMeans>");
    expect(invoice).not.toContain("InstructionNote");
  });

  it("embeds the ICV and previous invoice hash exactly as given", () => {
    const xml = buildDocumentXml(base({ icv: 42, previousInvoiceHash: "abc123==" }));
    expect(xml).toContain("<cbc:UUID>42</cbc:UUID>");
    expect(xml).toContain("abc123==");
  });

  it("groups tax subtotals by category+percent and sums correctly across multiple lines", () => {
    const xml = buildDocumentXml(
      base({
        lines: [
          { id: "1", name: "صنف خاضع 1", quantity: 1, unitPrice: 100, lineSubtotal: 100, lineVat: 15, taxCategoryCode: "S", taxPercent: 15 },
          { id: "2", name: "صنف خاضع 2", quantity: 2, unitPrice: 50, lineSubtotal: 100, lineVat: 15, taxCategoryCode: "S", taxPercent: 15 },
          { id: "3", name: "صنف معفى", quantity: 1, unitPrice: 30, lineSubtotal: 30, lineVat: 0, taxCategoryCode: "E", taxPercent: 0, taxExemptionReason: "إعفاء طبي" },
        ],
      }),
    );
    const doc = parse(xml);
    const taxSubtotals = doc.getElementsByTagName("cac:TaxSubtotal");
    expect(taxSubtotals.length).toBe(2); // فئة S واحدة مجمّعة + فئة E واحدة
    const invoiceLines = doc.getElementsByTagName("cac:InvoiceLine");
    expect(invoiceLines.length).toBe(3);
    expect(xml).toContain("إعفاء طبي");
    // إجمالي الضريبة على مستوى المستند (لا مستوى السطر) مكرَّر عمداً مرتين (قاعدة KSA)
    const docLevelTaxTotals = Array.from(doc.documentElement!.childNodes).filter(
      (n) => (n as { tagName?: string }).tagName === "cac:TaxTotal",
    );
    expect(docLevelTaxTotals.length).toBe(2);
  });

  // 65.96 + 49.72 = 115.68 حسابياً، لكن IEEE754 يُنتج 115.67999999999999 — truncateDecimals كان
  // سيبتر هذا لـ"115.67" فيُسقِط هللة كاملة من الإجمالي رغم أن كل سطر مُقرَّب بشكل صحيح تماماً
  // بخانتين عشريتين. هذا اختبار تراجع لإصلاح roundMoney المُضاف قبل truncateDecimals لكل مجموع.
  it("does not lose a halalah to floating-point noise when summing already-rounded line amounts", () => {
    const xml = buildDocumentXml(
      base({
        lines: [
          { id: "1", name: "أ", quantity: 1, unitPrice: 65.96, lineSubtotal: 65.96, lineVat: 0, taxCategoryCode: "E", taxPercent: 0, taxExemptionReason: "إعفاء" },
          { id: "2", name: "ب", quantity: 1, unitPrice: 49.72, lineSubtotal: 49.72, lineVat: 0, taxCategoryCode: "E", taxPercent: 0, taxExemptionReason: "إعفاء" },
        ],
      }),
    );
    expect(xml).toContain('<cbc:TaxableAmount currencyID="SAR">115.68</cbc:TaxableAmount>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="SAR">115.68</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">115.68</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">115.68</cbc:PayableAmount>');
    expect(xml).not.toContain("115.67<");
  });

  it("computes LegalMonetaryTotal as the sum of all line subtotals/vat", () => {
    const xml = buildDocumentXml(
      base({
        lines: [
          { id: "1", name: "أ", quantity: 1, unitPrice: 100, lineSubtotal: 100, lineVat: 15, taxCategoryCode: "S", taxPercent: 15 },
          { id: "2", name: "ب", quantity: 1, unitPrice: 200, lineSubtotal: 200, lineVat: 30, taxCategoryCode: "S", taxPercent: 15 },
        ],
      }),
    );
    expect(xml).toContain("<cbc:LineExtensionAmount currencyID=\"SAR\">300.00</cbc:LineExtensionAmount>");
    expect(xml).toContain("<cbc:TaxInclusiveAmount currencyID=\"SAR\">345.00</cbc:TaxInclusiveAmount>");
    expect(xml).toContain("<cbc:PayableAmount currencyID=\"SAR\">345.00</cbc:PayableAmount>");
  });
});

it("writes distinct zero-rated and exempt categories and their reason codes", () => {
 const xml = buildDocumentXml(base({ lines: [
  {id:"1",name:"Zero",quantity:1,unitPrice:100,lineSubtotal:100,lineVat:0,taxCategoryCode:"Z",taxPercent:0,taxExemptionReasonCode:"VATEX-SA-35",taxExemptionReason:"Medicine"},
  {id:"2",name:"Exempt",quantity:1,unitPrice:50,lineSubtotal:50,lineVat:0,taxCategoryCode:"E",taxPercent:0,taxExemptionReasonCode:"VATEX-SA-29",taxExemptionReason:"Financial services"},
 ] }));
 expect(xml).toContain("<cbc:TaxExemptionReasonCode>VATEX-SA-35</cbc:TaxExemptionReasonCode>");
 expect(xml).toContain("<cbc:TaxExemptionReasonCode>VATEX-SA-29</cbc:TaxExemptionReasonCode>");
});
