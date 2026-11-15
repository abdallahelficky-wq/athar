import { describe, expect, it, vi, beforeEach } from "vitest";

// ملاحظات الفاتورة والشروط والأحكام والحسابات البنكية أسفل الفاتورة — في القالبين (modern وclassicPro).
// HTML يُؤخَذ من buildPlainInvoicePdf نفسها (الكود الذي ينتج PDF الإيميل والتحميل فعلاً)، بالتقاط ما تمرّره إلى
// renderHtmlToPdf بدل بناء HTML يدوياً في الاختبار (قاعدة 2 في CLAUDE.md). التصيير عبر Chromium مغطّى في renderPdf.test.ts.
vi.mock("./zatca/pdf/renderPdf", () => ({ renderHtmlToPdf: vi.fn(async () => Buffer.from("pdf")) }));

import { renderHtmlToPdf } from "./zatca/pdf/renderPdf";
import { buildPlainInvoicePdf, PlainInvoicePdfInput } from "./invoicePdf";

const base: PlainInvoicePdfInput = {
  invoiceNumber: "INV-00001",
  date: new Date("2026-11-15"),
  companyName: "مؤسسة الاختبار",
  companyVatNumber: "300000000000003",
  customerName: "عميل الاختبار",
  lines: [{ description: "دفعة أعمال", quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, total: 115 }],
  subtotal: 100,
  vatTotal: 15,
  grandTotal: 115,
  qrPayload: "qr",
};

const bank = { bankName: "مصرف الراجحي", accountNumber: "123456789", iban: "SA0380000000608010167519" };

async function htmlFor(input: PlainInvoicePdfInput): Promise<string> {
  await buildPlainInvoicePdf(input);
  const calls = vi.mocked(renderHtmlToPdf).mock.calls;
  return calls[calls.length - 1][0] as string;
}

beforeEach(() => vi.mocked(renderHtmlToPdf).mockClear());

describe.each(["modern", "classicPro"] as const)("invoice footer notes — %s template", (template) => {
  it("prints notes and terms with their headings, escaped, keeping line breaks", async () => {
    const html = await htmlFor({
      ...base,
      template,
      notes: "عُدّلت حسب اعتماد موقد <b>",
      termsAndConditions: "السداد خلال 30 يوماً\nالأسعار شاملة الضريبة",
    });
    expect(html).toContain("ملاحظات");
    expect(html).toContain("Notes");
    expect(html).toContain("عُدّلت حسب اعتماد موقد &lt;b&gt;");
    expect(html).not.toContain("موقد <b>");
    expect(html).toContain("الشروط والأحكام");
    expect(html).toContain("السداد خلال 30 يوماً<br/>الأسعار شاملة الضريبة");
  });

  it("prints the company bank accounts (bank, account number, IBAN) from settings", async () => {
    const html = await htmlFor({ ...base, template, bankAccounts: [bank] });
    expect(html).toContain("مصرف الراجحي");
    expect(html).toContain("123456789");
    expect(html).toContain("SA0380000000608010167519");
  });

  it("prints no notes/terms section when both are empty or whitespace", async () => {
    const html = await htmlFor({ ...base, template, notes: "  ", termsAndConditions: null });
    expect(html).not.toContain('class="inv-notes"');
    expect(html).not.toContain("الشروط والأحكام");
  });
});

describe("classicPro line unit fallback", () => {
  it("renders the default bilingual unit label as markup, not escaped text, when a line has no unit", async () => {
    const html = await htmlFor({ ...base, template: "classicPro" });
    expect(html).not.toContain("&lt;span class=&quot;en&quot;&gt;");
    expect(html).toContain('وحدة <span class="en">/ Unit</span>');
  });
});

