import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReceiptEscPos } from "./escpos.js";

// راجع تقرير التحقق من مصدر زاتكا الذي سبق هذا التعديل: كتلة البائع (اسم/رقم ضريبي/عنوان) غير
// مشروطة بنوع الفاتورة إطلاقاً في xmlBuilder.ts (AccountingSupplierParty ثابتة في القالب)، بينما
// كتلة المشتري (اسم/عنوان/رقم ضريبي) إلزامية فقط لفاتورة قياسية (buildBuyerBlock + types.ts) —
// الفاتورة المبسّطة تترك AccountingCustomerParty فارغة تماماً. هذا الملف يتحقق أن buildReceiptEscPos
// يطابق نفس القاعدة على الإيصال الحراري.

const company = {
  name: "شركة أثر التجريبية",
  vatNumber: "310123456700003",
  addressBuilding: "1234",
  addressStreet: "طريق الملك فهد",
  addressCity: "الرياض",
};

function decode(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function baseInvoice(overrides = {}) {
  return {
    invoiceNumber: "INV-00001",
    date: "2026-09-24T10:00:00.000Z",
    invoiceType: "simplified",
    zatcaStatus: "not_applicable",
    grandTotal: 115,
    subtotal: 100,
    vatTotal: 15,
    lines: [{ description: "خدمة استشارية", quantity: 1, unitPrice: 100, total: 115 }],
    customer: { name: "عميل تجريبي" },
    ...overrides,
  };
}

test("standard invoice receipt prints the buyer's VAT number and full address", () => {
  const invoice = baseInvoice({
    invoiceType: "standard",
    customer: { name: "شركة العميل", vatNumber: "310987654300003", buildingNo: "99", street: "شارع التحلية", city: "جدة" },
  });
  const text = decode(buildReceiptEscPos({ company, invoice }, 80));
  assert.match(text, /الرقم الضريبي للعميل: 310987654300003/);
  assert.match(text, /عنوان العميل: 99، شارع التحلية، جدة/);
});

test("simplified invoice receipt prints no buyer VAT number or address lines at all", () => {
  // حتى لو تصادف وجود هذه البيانات فعلياً على العميل، فاتورة مبسّطة لا تطبعها — غير مطلوبة زاتكا
  const invoice = baseInvoice({
    invoiceType: "simplified",
    customer: { name: "عميل نقدي", vatNumber: "999999999900003", street: "شارع ما", city: "مدينة" },
  });
  const text = decode(buildReceiptEscPos({ company, invoice }, 80));
  assert.doesNotMatch(text, /الرقم الضريبي للعميل/);
  assert.doesNotMatch(text, /عنوان العميل/);
});

test("seller name, VAT number, and address print for both standard and simplified invoices", () => {
  for (const invoiceType of ["standard", "simplified"]) {
    const invoice = baseInvoice({ invoiceType, customer: { name: "عميل" } });
    const text = decode(buildReceiptEscPos({ company, invoice }, 80));
    assert.match(text, /شركة أثر التجريبية/);
    assert.match(text, /الرقم الضريبي: 310123456700003/);
    assert.match(text, /العنوان: 1234، طريق الملك فهد، الرياض/);
  }
});

test("ZATCA acceptance line is derived from the stored zatcaStatus, and printed only when accepted", () => {
  const cleared = decode(buildReceiptEscPos({ company, invoice: baseInvoice({ zatcaStatus: "cleared" }) }, 80));
  assert.match(cleared, /تم تخليص الفاتورة/);
  assert.doesNotMatch(cleared, /تم إبلاغ الفاتورة/);

  const reported = decode(buildReceiptEscPos({ company, invoice: baseInvoice({ zatcaStatus: "reported" }) }, 80));
  assert.match(reported, /تم إبلاغ الفاتورة/);
  assert.doesNotMatch(reported, /تم تخليص الفاتورة/);

  for (const zatcaStatus of ["not_applicable", "not_submitted", "rejected", "submission_failed", "certificate_error", "compliance_checked"]) {
    const text = decode(buildReceiptEscPos({ company, invoice: baseInvoice({ zatcaStatus }) }, 80));
    assert.doesNotMatch(text, /تم تخليص الفاتورة/);
    assert.doesNotMatch(text, /تم إبلاغ الفاتورة/);
  }
});

test("issuer name prints only when known", () => {
  const withIssuer = decode(buildReceiptEscPos({ company, invoice: baseInvoice({ issuedByName: "محمد أحمد" }) }, 80));
  assert.match(withIssuer, /البائع: محمد أحمد/);

  const withoutIssuer = decode(buildReceiptEscPos({ company, invoice: baseInvoice() }, 80));
  assert.doesNotMatch(withoutIssuer, /البائع:/);
});

test("a long seller address wraps across multiple lines within the 58mm paper width instead of being truncated", () => {
  const longStreet = "شارع طويل جداً لاختبار التفاف النص على عدة أسطر بدل بتره داخل عرض الورق الضيق فعلياً هنا الآن";
  const wideCompany = { ...company, addressStreet: longStreet };
  const width = 32; // عمود 58مم بالأحرف، راجع buildReceiptEscPos
  const text = decode(buildReceiptEscPos({ company: wideCompany, invoice: baseInvoice() }, 58));

  const afterLabel = text.slice(text.indexOf("العنوان:"));
  const divider = "-".repeat(width);
  const block = afterLabel.slice(0, afterLabel.indexOf(divider));
  const addressLines = block.split("\n").map((l) => l.trim()).filter(Boolean);

  assert.ok(addressLines.length > 1, "expected the long address to wrap onto more than one line");
  for (const line of addressLines) {
    assert.ok(line.length <= width, `line exceeds the 58mm width: "${line}" (${line.length} chars)`);
  }
  // العنوان يجب ألا يُبتَر — آخر كلماته يجب أن تظهر كاملة في الأسطر الملتفة
  const rejoined = addressLines.join(" ");
  assert.ok(rejoined.includes("الآن"), "wrapped address must not drop trailing words");
});
