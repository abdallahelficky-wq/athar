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

  it("uses reporting:1.0 profile and 0200000 type name for simplified invoices, no buyer block content", () => {
    const xml = buildDocumentXml(base({ subtype: "simplified" }));
    expect(xml).toContain("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>");
    expect(xml).toContain('name="0200000"');
    expect(xml).toContain(">388<");
    expect(xml).toContain("<cac:AccountingCustomerParty></cac:AccountingCustomerParty>");
  });

  it("uses clearance:1.0 profile, 0100000 type name, and full buyer block for standard invoices", () => {
    const xml = buildDocumentXml(base({ subtype: "standard", buyer: BUYER }));
    expect(xml).toContain("<cbc:ProfileID>clearance:1.0</cbc:ProfileID>");
    expect(xml).toContain('name="0100000"');
    expect(xml).toContain(BUYER.registrationName);
    expect(xml).toContain(BUYER.vatNumber);
  });

  it("throws if a standard invoice is built without buyer data", () => {
    expect(() => buildDocumentXml(base({ subtype: "standard" }))).toThrow();
  });

  it("uses invoice type code 381 for credit notes and 383 for debit notes, with a billing reference", () => {
    const credit = buildDocumentXml(base({ kind: "credit_note", billingReferenceId: "INV-00001" }));
    expect(credit).toContain(">381<");
    expect(credit).toContain("<cac:BillingReference>");
    expect(credit).toContain("INV-00001");

    const debit = buildDocumentXml(base({ kind: "debit_note", billingReferenceId: "INV-00001" }));
    expect(debit).toContain(">383<");
  });

  it("throws if a credit/debit note is built without a billing reference", () => {
    expect(() => buildDocumentXml(base({ kind: "credit_note" }))).toThrow();
    expect(() => buildDocumentXml(base({ kind: "debit_note" }))).toThrow();
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
