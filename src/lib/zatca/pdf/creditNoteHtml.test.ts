import { describe, expect, it } from "vitest";
import { buildInvoiceHtml, InvoicePdfData } from "./invoiceHtmlTemplate";

// يغطي أن buildInvoiceHtml — الأنبوب المشترك بين buildPlainInvoicePdf وbuildPlainCreditNotePdf
// (راجع src/lib/invoicePdf.ts) — يعرض فعلياً عنوان "إشعار دائن" ومرجع الفاتورة الأصلية (رقمها
// وتاريخها) وسبب الإصدار وQR عندما تُمرَّر هذه الحقول، ولا يعرضها إطلاقاً حين تكون غائبة (إشعار
// داخلي بلا فاتورة أصلية مرتبطة). هذا اختبار محتوى HTML لا PDF مُصيَّر فعلياً — راجع
// renderPdf.test.ts/arabicFontCheck.test.ts لتغطية التصيير الفعلي عبر Chromium.
const baseData: InvoicePdfData = {
  documentTitleAr: "إشعار دائن",
  documentNumber: "RET-1001",
  issueDate: "2026-02-06",
  companyName: "شركة الاختبار",
  companyVatNumber: "300000000000003",
  customerName: "عميل الاختبار",
  lines: [{ description: "صنف مرتجع", quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, total: 115 }],
  subtotal: 100,
  vatTotal: 15,
  grandTotal: 115,
  qrDataUrl: "data:image/png;base64,fakeqr",
  zatcaUuid: "uuid-1234",
};

describe("buildInvoiceHtml — credit note fields", () => {
  it("renders the credit note title in Arabic and its English mapping", () => {
    const html = buildInvoiceHtml(baseData);
    expect(html).toContain("إشعار دائن");
    expect(html).toContain("Credit Note");
  });

  it("renders the original invoice number and date when billingReference is provided", () => {
    const html = buildInvoiceHtml({
      ...baseData,
      billingReference: { number: "INV-00042", date: "2026-01-15" },
    });
    expect(html).toContain("INV-00042");
    expect(html).toContain("2026-01-15");
    expect(html).toContain("الفاتورة الأصلية");
    expect(html).toContain("Original Invoice");
  });

  it("renders the issuance reason when provided", () => {
    const html = buildInvoiceHtml({ ...baseData, issuanceReason: "بضاعة تالفة" });
    expect(html).toContain("بضاعة تالفة");
    expect(html).toContain("السبب");
    expect(html).toContain("Reason");
  });

  it("omits the original-invoice and reason rows entirely when absent (internal credit note with no related invoice)", () => {
    const html = buildInvoiceHtml(baseData);
    expect(html).not.toContain("الفاتورة الأصلية");
    expect(html).not.toContain("السبب");
  });

  it("renders the QR code image and the ZATCA UUID", () => {
    const html = buildInvoiceHtml(baseData);
    expect(html).toContain(`src="${baseData.qrDataUrl}"`);
    expect(html).toContain("uuid-1234");
  });
});
