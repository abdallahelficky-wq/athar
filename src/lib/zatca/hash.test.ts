import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { buildDocumentXml } from "./xmlBuilder";
import { computeDocumentHash } from "./hash";
import { ZATCA_FIRST_INVOICE_PIH, ZatcaDocumentInput } from "./types";

const SAMPLE_SELLER = {
  vatNumber: "300000000000003",
  crNumber: "1010101010",
  registrationName: "شركة أثر التجريبية",
  street: "طريق الملك فهد",
  buildingNumber: "1234",
  citySubdivision: "العليا",
  city: "الرياض",
  postalZone: "12345",
};

function sampleDocument(overrides: Partial<ZatcaDocumentInput> = {}): ZatcaDocumentInput {
  return {
    kind: "invoice",
    subtype: "simplified",
    id: "INV-00001",
    uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
    issueDate: "2026-08-01",
    issueTime: "10:00:00",
    icv: 1,
    previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH,
    seller: SAMPLE_SELLER,
    lines: [
      {
        id: "1",
        name: "خدمة استشارية",
        quantity: 1,
        unitPrice: 100,
        lineSubtotal: 100,
        lineVat: 15,
        taxCategoryCode: "S",
        taxPercent: 15,
      },
    ],
    ...overrides,
  };
}

describe("ZATCA_FIRST_INVOICE_PIH", () => {
  it("equals base64(hex(sha256('0'))) — the documented ZATCA constant for the first invoice in a chain", () => {
    const hex = createHash("sha256").update("0").digest("hex");
    expect(Buffer.from(hex).toString("base64")).toBe(ZATCA_FIRST_INVOICE_PIH);
  });
});

describe("computeDocumentHash", () => {
  it("is deterministic for the same input", () => {
    const xml = buildDocumentXml(sampleDocument());
    expect(computeDocumentHash(xml)).toBe(computeDocumentHash(xml));
  });

  it("changes when any document content changes", () => {
    const a = buildDocumentXml(sampleDocument());
    const b = buildDocumentXml(sampleDocument({ id: "INV-00002" }));
    expect(computeDocumentHash(a)).not.toBe(computeDocumentHash(b));
  });

  it("is unaffected by the QR placeholder value since the whole QR block is stripped before hashing", () => {
    const xml = buildDocumentXml(sampleDocument());
    const withQr = xml.replace(
      '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain"></cbc:EmbeddedDocumentBinaryObject>',
      '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">SOME_QR_PAYLOAD</cbc:EmbeddedDocumentBinaryObject>',
    );
    expect(withQr).not.toBe(xml);
    expect(computeDocumentHash(withQr)).toBe(computeDocumentHash(xml));
  });

  it("produces a 3-invoice PIH chain where each hash becomes the next document's previousInvoiceHash", () => {
    const doc1 = sampleDocument({ id: "INV-00001", icv: 1, previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH });
    const hash1 = computeDocumentHash(buildDocumentXml(doc1));

    const doc2 = sampleDocument({ id: "INV-00002", icv: 2, previousInvoiceHash: hash1 });
    const hash2 = computeDocumentHash(buildDocumentXml(doc2));

    const doc3 = sampleDocument({ id: "INV-00003", icv: 3, previousInvoiceHash: hash2 });
    const hash3 = computeDocumentHash(buildDocumentXml(doc3));

    expect(hash1).not.toBe(hash2);
    expect(hash2).not.toBe(hash3);
    // كل تجزئة تدخل ضمن نص المستند التالي (كـ PIH)، فبالضرورة أي كسر/إعادة ترتيب لهذه السلسلة
    // ينتج تجزئة مختلفة بالكامل — هذا ما يجعل الحذف/الإدراج في المنتصف قابلاً للاكتشاف.
    expect(buildDocumentXml(doc2)).toContain(hash1);
    expect(buildDocumentXml(doc3)).toContain(hash2);
  });
});
