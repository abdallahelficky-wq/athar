import { describe, expect, it } from "vitest";
import { buildQrBaseParams, rebuildZatcaDocumentXml } from "./chain";

// عطل إنتاج فعلي مؤكَّد: كل مستند مبسَّط كان يعود بتحذير "Time on QR Code does not match with
// Invoice Issue Time (KSA-25)" رغم أن IssueTime وQR Tag 3 يحملان نفس الأرقام حرفياً (نفس issuedAt).
// السبب: IssueTime كانت تُكتَب بلا لاحقة "Z" (تُقرَأ كتوقيت محلي AST حسب معيار XML لزاتكا)، بينما
// أرقامها الفعلية UTC (من toISOString()) وQR Tag 3 يحمل "Z" صراحةً (UTC) — فرق ٣ ساعات فعلي في
// التفسير رغم تطابق الأرقام. هذا الملف يثبت أن الإصلاح (isoUtcTimestamp/formatIssueTimeUtc في
// chain.ts) يجعل الحقلين يشتقّان من نفس issuedAt بصيغة متطابقة تماماً، فلا يمكن أن ينحرفا مجدداً.

const COMPANY = {
  id: "company-1",
  zatcaOnboardingStatus: "production",
  zatcaEnvironment: "sandbox",
  zatcaLastInvoiceHash: null,
  name: "شركة أثر التجريبية",
  vatNumber: "300000000000003",
  crNumber: "1010101010",
  addressStreet: "طريق الملك فهد",
  addressBuilding: "1234",
  addressDistrict: "العليا",
  addressCity: "الرياض",
  addressPostalCode: "12345",
};

const SIMPLIFIED_CUSTOMER = {
  customerType: "individual",
  vatNumber: null,
  crNumber: null,
  name: "عميل نقدي",
  street: null,
  buildingNo: null,
  district: null,
  city: null,
  postalCode: null,
};

const LINES = [
  { description: "خدمة", quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, taxCategoryCode: "S", taxExemptionReason: null },
];

function extractIssueTime(xml: string): string {
  const match = /<cbc:IssueTime>([^<]+)<\/cbc:IssueTime>/.exec(xml);
  if (!match) throw new Error("cbc:IssueTime غير موجود في الـXML الناتج");
  return match[1];
}

describe("IssueTime and QR Tag 3 never diverge", () => {
  it("produces an IssueTime that is byte-identical to the time portion of the QR timestamp, both ending in Z (UTC)", () => {
    const issuedAt = new Date("2026-09-21T08:40:58.000Z");
    const rebuilt = rebuildZatcaDocumentXml({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00001",
      documentUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
      lines: LINES,
      icv: 1,
      previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
      issuedAt,
    });
    const qrBaseParams = buildQrBaseParams(COMPANY, issuedAt, 115, 15);

    const issueTimeFromXml = extractIssueTime(rebuilt.xml);
    const timeFromQr = qrBaseParams.isoTimestamp.slice(11);

    expect(issueTimeFromXml).toBe("08:40:58Z");
    expect(qrBaseParams.isoTimestamp).toBe("2026-09-21T08:40:58Z");
    expect(issueTimeFromXml).toBe(timeFromQr);
    expect(issueTimeFromXml.endsWith("Z")).toBe(true);
    expect(qrBaseParams.isoTimestamp.endsWith("Z")).toBe(true);
  });

  it("stays byte-identical for a non-whole-hour, non-UTC-midnight timestamp too", () => {
    const issuedAt = new Date("2026-01-15T23:07:03.451Z");
    const rebuilt = rebuildZatcaDocumentXml({
      company: COMPANY,
      customer: SIMPLIFIED_CUSTOMER,
      kind: "invoice",
      documentNumber: "INV-00002",
      documentUuid: "4df6eecf-2492-45a0-b8a3-0ee7b1a92b45",
      lines: LINES,
      icv: 2,
      previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
      issuedAt,
    });
    const qrBaseParams = buildQrBaseParams(COMPANY, issuedAt, 230, 30);

    const issueTimeFromXml = extractIssueTime(rebuilt.xml);
    // milliseconds لا تظهر في أيّ من الحقلين — كلاهما يُقتطَع من نفس isoUtcTimestamp() التي تُسقِطها.
    expect(issueTimeFromXml).toBe("23:07:03Z");
    expect(qrBaseParams.isoTimestamp).toBe("2026-01-15T23:07:03Z");
    expect(issueTimeFromXml).toBe(qrBaseParams.isoTimestamp.slice(11));
  });
});
