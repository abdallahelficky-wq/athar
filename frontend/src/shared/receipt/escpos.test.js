import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReceiptContentModel, buildThankYouContentModel } from "./escpos.js";

// راجع تقرير التحقق من مصدر زاتكا الذي سبق هذا التعديل: كتلة البائع (اسم/رقم ضريبي/عنوان) غير
// مشروطة بنوع الفاتورة إطلاقاً في xmlBuilder.ts (AccountingSupplierParty ثابتة في القالب)، بينما
// كتلة المشتري (اسم/عنوان/رقم ضريبي) إلزامية فقط لفاتورة قياسية (buildBuyerBlock + types.ts) —
// الفاتورة المبسّطة تترك AccountingCustomerParty فارغة تماماً.
//
// هذا الملف يختبر buildReceiptContentModel (نموذج المحتوى الوصفي — نص/محاذاة، بلا أي رسم/canvas)
// لا buildReceiptEscPos نفسها: الأخيرة تحتاج DOM حقيقياً (canvas) بعد التحوّل لصورة نقطية لحل عطل
// الترميز العربي المؤكَّد على جهاز Sunmi V2 حقيقي (راجع تعليق أعلى escpos.js)، فلم تعد قابلة
// للاستدعاء المباشر من node:test. buildReceiptContentModel هي بالضبط الجزء الذي يحمل منطق العمل
// (أي الحقول تظهر ومتى) وبقي مستقلاً عن أي متصفح تحديداً لهذا السبب — راجع أيضاً
// e2e/receiptRaster.spec.js للتحقق البصري الفعلي من التصيير على canvas حقيقي عبر Playwright.

const company = {
  name: "شركة أثر التجريبية",
  vatNumber: "310123456700003",
  addressBuilding: "1234",
  addressStreet: "طريق الملك فهد",
  addressCity: "الرياض",
};

function baseInvoice(overrides = {}) {
  return {
    invoiceNumber: "INV-00001",
    date: "2026-09-24T10:00:00.000Z",
    invoiceType: "simplified",
    zatcaStatus: "not_applicable",
    grandTotal: 115,
    subtotal: 100,
    vatTotal: 15,
    lines: [{ description: "خدمة استشارية", quantity: 1, unitPrice: 100, subtotal: 100, total: 115 }],
    customer: { name: "عميل تجريبي" },
    ...overrides,
  };
}

function textOf(blocks) {
  return blocks.filter((b) => b.type === "line").map((b) => b.text).join("\n");
}

test("standard invoice receipt model includes the buyer's VAT number and full address", () => {
  const invoice = baseInvoice({
    invoiceType: "standard",
    customer: { name: "شركة العميل", vatNumber: "310987654300003", buildingNo: "99", street: "شارع التحلية", city: "جدة" },
  });
  const text = textOf(buildReceiptContentModel({ company, invoice }));
  assert.match(text, /الرقم الضريبي للعميل: 310987654300003/);
  assert.match(text, /عنوان العميل: 99، شارع التحلية، جدة/);
});

test("simplified invoice receipt model has no buyer VAT number or address lines at all", () => {
  // حتى لو تصادف وجود هذه البيانات فعلياً على العميل، فاتورة مبسّطة لا تطبعها — غير مطلوبة زاتكا
  const invoice = baseInvoice({
    invoiceType: "simplified",
    customer: { name: "عميل نقدي", vatNumber: "999999999900003", street: "شارع ما", city: "مدينة" },
  });
  const text = textOf(buildReceiptContentModel({ company, invoice }));
  assert.doesNotMatch(text, /الرقم الضريبي للعميل/);
  assert.doesNotMatch(text, /عنوان العميل/);
});

test("seller name, VAT number, and address appear for both standard and simplified invoices", () => {
  for (const invoiceType of ["standard", "simplified"]) {
    const invoice = baseInvoice({ invoiceType, customer: { name: "عميل" } });
    const blocks = buildReceiptContentModel({ company, invoice });
    const text = textOf(blocks);
    assert.match(text, /شركة أثر التجريبية/);
    assert.match(text, /الرقم الضريبي: 310123456700003/);
    assert.match(text, /العنوان: 1234، طريق الملك فهد، الرياض/);
    // كتلة البائع بمحاذاة الوسط تحديداً (نفس التخطيط الأصلي قبل التحويل لصورة نقطية)
    const nameLine = blocks.find((b) => b.type === "line" && b.text === company.name);
    assert.equal(nameLine.align, "center");
    assert.equal(nameLine.bold, true);
    assert.equal(nameLine.large, true);
  }
});

test("ZATCA acceptance line is derived from the stored zatcaStatus, and present only when accepted", () => {
  const cleared = textOf(buildReceiptContentModel({ company, invoice: baseInvoice({ zatcaStatus: "cleared" }) }));
  assert.match(cleared, /تم تخليص الفاتورة/);
  assert.doesNotMatch(cleared, /تم إبلاغ الفاتورة/);

  const reported = textOf(buildReceiptContentModel({ company, invoice: baseInvoice({ zatcaStatus: "reported" }) }));
  assert.match(reported, /تم إبلاغ الفاتورة/);
  assert.doesNotMatch(reported, /تم تخليص الفاتورة/);

  for (const zatcaStatus of ["not_applicable", "not_submitted", "rejected", "submission_failed", "certificate_error", "compliance_checked"]) {
    const text = textOf(buildReceiptContentModel({ company, invoice: baseInvoice({ zatcaStatus }) }));
    assert.doesNotMatch(text, /تم تخليص الفاتورة/);
    assert.doesNotMatch(text, /تم إبلاغ الفاتورة/);
  }
});

test("issuer name appears only when known", () => {
  const withIssuer = textOf(buildReceiptContentModel({ company, invoice: baseInvoice({ issuedByName: "محمد أحمد" }) }));
  assert.match(withIssuer, /البائع: محمد أحمد/);

  const withoutIssuer = textOf(buildReceiptContentModel({ company, invoice: baseInvoice() }));
  assert.doesNotMatch(withoutIssuer, /البائع:/);
});

test("a long seller address is kept as one unbroken string in the model — wrapping happens later, by measured pixel width on canvas, not by character count here", () => {
  const longStreet = "شارع طويل جداً لاختبار عدم بتر النص هنا داخل نموذج المحتوى نفسه فعلياً الآن";
  const wideCompany = { ...company, addressStreet: longStreet };
  const text = textOf(buildReceiptContentModel({ company: wideCompany, invoice: baseInvoice() }));
  assert.match(text, new RegExp(longStreet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("thank-you block is a separate, centered content model (printed after the QR, not part of the main body)", () => {
  const blocks = buildThankYouContentModel();
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].align, "center");
  assert.match(blocks[0].text, /شكراً لتعاملكم معنا/);
});

test("line items and grand total appear with the expected alignment", () => {
  const invoice = baseInvoice({
    lines: [{ description: "قطعة غيار", quantity: 3, unitPrice: 50, subtotal: 150, total: 172.5 }],
    subtotal: 150,
    vatTotal: 22.5,
    grandTotal: 172.5,
  });
  const blocks = buildReceiptContentModel({ company, invoice });
  const itemLine = blocks.find((b) => b.type === "line" && b.text === "قطعة غيار");
  // المستند عربي/RTL بالكامل — كل سطر يلتصق باليمين الآن (كشف الاختبار الثاني على جهاز حقيقي أن
  // "left" كانت بقية من محاذاة ESC/POS النصية القديمة، لا قراراً تصميمياً).
  assert.equal(itemLine.align, "right");
  const totalLine = blocks.find((b) => b.type === "line" && /الإجمالي: 172\.50/.test(b.text));
  assert.equal(totalLine.align, "right");
  assert.equal(totalLine.bold, true);
});

test("the item calculation line is qty × unitPrice = pre-VAT subtotal, never the VAT-inclusive total — a receipt must not print a false equation", () => {
  // الاختبار الثاني على جهاز حقيقي كشف طباعة "3.50 × 60 = 241.50" — معادلة خاطئة حسابياً، لأن
  // 241.50 هو total شامل ضريبة 15% لا ناتج الضرب الفعلي (3.50×60=210.00). نقطة البيع لا تدعم خصم
  // سطر إطلاقاً، فـ qty×unitPrice يساوي subtotal دائماً فعلياً هنا.
  const invoice = baseInvoice({
    lines: [{ description: "صنف", quantity: 3.5, unitPrice: 60, subtotal: 210, vat: 31.5, total: 241.5 }],
    subtotal: 210,
    vatTotal: 31.5,
    grandTotal: 241.5,
  });
  const text = textOf(buildReceiptContentModel({ company, invoice }));
  assert.match(text, /3\.5 × 60\.00 = 210\.00/);
  assert.doesNotMatch(text, /= 241\.50/, "must never claim qty × unitPrice equals the VAT-inclusive total");
});

test("the pre-VAT subtotal and VAT amount print as separate lines before the grand total (ZATCA requires the VAT amount to be shown)", () => {
  const invoice = baseInvoice({ subtotal: 210, vatTotal: 31.5, grandTotal: 241.5 });
  const blocks = buildReceiptContentModel({ company, invoice });
  const beforeVatLine = blocks.find((b) => b.type === "line" && /قبل الضريبة: 210\.00/.test(b.text));
  const vatLine = blocks.find((b) => b.type === "line" && /^الضريبة: 31\.50$/.test(b.text));
  assert.ok(beforeVatLine, "expected a 'قبل الضريبة' line");
  assert.ok(vatLine, "expected a 'الضريبة' line");
  assert.equal(beforeVatLine.align, "right");
  assert.equal(vatLine.align, "right");
});

test("the document title is derived from the invoice subtype, printed as the very first block", () => {
  const standardTitle = buildReceiptContentModel({ company, invoice: baseInvoice({ invoiceType: "standard", customer: { name: "شركة" } }) })[0];
  assert.equal(standardTitle.text, "فاتورة ضريبية");
  assert.equal(standardTitle.align, "center");

  const simplifiedTitle = buildReceiptContentModel({ company, invoice: baseInvoice({ invoiceType: "simplified" }) })[0];
  assert.equal(simplifiedTitle.text, "فاتورة ضريبية مبسطة");
});

test("the printed date is Gregorian with Western digits, never Hijri — BT-2 is a Gregorian date", () => {
  // الاختبار الثاني على جهاز حقيقي كشف طباعة "١٤٤٦/٤/١٤ هـ" (هجري) رغم أن toLocaleString("ar-SA")
  // العادية بلا calendar/numberingSystem صريحين تفترض التقويم الهجري افتراضياً في ICU/V8.
  const text = textOf(buildReceiptContentModel({ company, invoice: baseInvoice({ date: "2026-09-24T20:49:00.000Z" }) }));
  const dateLine = text.split("\n").find((l) => l.startsWith("التاريخ: "));
  assert.ok(dateLine, "expected a التاريخ line");
  assert.doesNotMatch(dateLine, /هـ/);
  assert.doesNotMatch(dateLine, /[٠-٩]/, "must not contain Arabic-Indic digits");
  assert.match(dateLine, /2026/);
});
