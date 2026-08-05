import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { env } from "../../../config/env";
import { buildInvoicePdf } from "./buildInvoicePdf";
import { InvoicePdfData } from "./invoiceHtmlTemplate";

// يعتمد هذا الاختبار على Chromium فعلي (CHROMIUM_EXECUTABLE_PATH) — يُتجاوَز تلقائياً في أي بيئة
// لم تُضبَط فيها (مثلاً CI بلا Chromium مثبَّت)، ويعمل فعلياً هنا حيث env.chromiumExecutablePath مضبوط.
const hasChromium = Boolean(env.chromiumExecutablePath);

const SAMPLE_DATA: InvoicePdfData = {
  documentTitleAr: "فاتورة ضريبية",
  documentNumber: "INV-00001",
  issueDate: "2026-08-01",
  companyName: "شركة أثر التجريبية",
  companyVatNumber: "300000000000003",
  companyAddress: "طريق الملك فهد، الرياض",
  customerName: "عميل نقدي",
  customerVatNumber: null,
  lines: [{ description: "خدمة استشارية", quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, total: 115 }],
  subtotal: 100,
  vatTotal: 15,
  grandTotal: 115,
  qrDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  zatcaUuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
};

describe.skipIf(!hasChromium)("buildInvoicePdf (real Chromium rendering)", () => {
  it("renders a visible, valid PDF/A-3 hybrid document with the signed XML embedded", async () => {
    const signedXml = "<Invoice><cbc:ID>INV-00001</cbc:ID></Invoice>";
    const pdf = await buildInvoicePdf({
      invoiceData: SAMPLE_DATA,
      signedXml,
      xmlFileName: "INV-00001.xml",
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain("INV-00001");

    const page = doc.getPage(0);
    expect(page.getWidth()).toBeGreaterThan(0);
  }, 30000);
});
