// قالب HTML بديل إضافي لطباعة فاتورة مبيعات إلى PDF عبر Puppeteer — "كلاسيكي احترافي"، مبني
// على تحليل نموذج فاتورة مرجعي (مرفق من المستخدم): هيدر ثنائي اللغة مع شعار، صندوقا مورّد/عميل
// متوازيان، شريط معلومات أفقي، جدول أصناف بترويسة داكنة وتظليل متبادل، إجماليات + رمز QR (رمز
// ZATCA الرسمي الوحيد المستخدَم بالفعل في النظام — لا يُضاف أي رمز ثانٍ وهمي)، وجدول حسابات
// بنكية عند وجودها. يُضاف كخيار بديل فقط، بجانب buildInvoiceHtml (القالب الحالي) دون حذفه أو
// تعديله — كلاهما يُستخدَم حسب Company.invoiceTemplate (انظر invoicePdf.ts).
//
// نفس فلسفة invoiceHtmlTemplate.ts بالضبط بخصوص اللغة: عربي أساسي دائماً + إنجليزي مساعد بجانبه
// عبر bi()، بصرف النظر عن Company.language — مستند فاتورة ضريبية رسمية (المادة 53 من اللائحة
// التنفيذية لضريبة القيمة المضافة). القيم (أسماء/أرقام) لا تُترجَم، فقط التسميات الثابتة.

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bi(ar: string, en: string): string {
  return `${escapeHtml(ar)} <span class="en">/ ${escapeHtml(en)}</span>`;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface ClassicProInvoiceLine {
  description: string;
  itemCode?: string | null;
  unit?: string | null;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  subtotal: number;
  vat: number;
  total: number;
}

export interface ClassicProBankAccount {
  bankName: string;
  accountNumber: string;
  iban: string;
}

export interface ClassicProInvoicePdfData {
  documentNumber: string;
  issueDate: string; // YYYY-MM-DD
  dueDate?: string | null;
  customerReference?: string | null;
  poNumber?: string | null;
  salesperson?: string | null;
  otherId?: string | null;
  paymentMethod?: string | null;

  companyName: string;
  companyNameEn?: string | null;
  companyLogoDataUrl?: string | null;
  companyVatNumber?: string | null;
  companyCrNumber?: string | null;
  companyUnifiedEntityNumber?: string | null;
  companyLicenseNumber?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  brandColor?: string | null;
  branchName?: string | null;

  customerName: string;
  customerVatNumber?: string | null;
  customerUnifiedEntityNumber?: string | null;
  customerAddress?: string | null;

  lines: ClassicProInvoiceLine[];
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  paidAmount: number;

  qrDataUrl: string;
  bankAccounts: ClassicProBankAccount[];
}

export function buildInvoiceHtmlClassicPro(data: ClassicProInvoicePdfData): string {
  const accent = data.brandColor || "#0B5E3B";
  const remaining = data.grandTotal - data.paidAmount;

  const rowsHtml = data.lines
    .map(
      (l, i) => `
        <tr class="${i % 2 === 1 ? "alt" : ""}">
          <td class="num">${i + 1}</td>
          <td class="desc">${escapeHtml(l.description)}${l.itemCode ? `<div class="code">${escapeHtml(l.itemCode)}</div>` : ""}</td>
          <td>${escapeHtml(l.unit || bi("وحدة", "Unit"))}</td>
          <td class="num">${l.quantity.toFixed(2)}</td>
          <td class="num">${formatMoney(l.unitPrice)}</td>
          <td class="num">${l.discountPct.toFixed(2)}</td>
          <td class="num">${formatMoney(l.subtotal)}</td>
          <td class="num">${formatMoney(l.vat)}</td>
          <td class="num amount">${formatMoney(l.total)}</td>
        </tr>`,
    )
    .join("");

  const infoCell = (ar: string, en: string, value?: string | null) =>
    value ? `<div class="info-cell"><div class="info-label">${bi(ar, en)}</div><div class="info-value">${escapeHtml(value)}</div></div>` : "";

  const bankRowsHtml = data.bankAccounts
    .map(
      (b) => `
        <tr>
          <td>${escapeHtml(b.bankName)}</td>
          <td class="num">${escapeHtml(b.accountNumber)}</td>
          <td class="num">${escapeHtml(b.iban)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${bi("فاتورة ضريبية", "Tax Invoice")} ${escapeHtml(data.documentNumber)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #1a2733; margin: 0; direction: rtl; font-size: 12px; }
  .en { font-size: 0.88em; color: #52606d; font-weight: 400; unicode-bidi: isolate; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .head-title { font-size: 20px; font-weight: 700; color: ${accent}; }
  .head-title .en { display: block; font-size: 12px; font-weight: 600; }
  .head-company { text-align: center; }
  .head-company-ar { font-size: 15px; font-weight: 700; }
  .head-company-en { font-size: 12px; color: #52606d; }
  .head-logo img { max-height: 64px; max-width: 120px; border-radius: 50%; }

  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .party-box { border: 1px solid #d7dde2; border-radius: 6px; padding: 10px 12px; }
  .party-title { font-weight: 700; font-size: 12px; margin-bottom: 6px; color: ${accent}; }
  .party-box .row { margin-bottom: 3px; }
  .party-box .row .val { font-weight: 600; }

  .info-bar { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 14px; }
  .info-cell { border: 1px solid #d7dde2; border-radius: 6px; padding: 6px 8px; text-align: center; }
  .info-label { font-size: 9.5px; color: #52606d; }
  .info-value { font-weight: 700; font-size: 11.5px; margin-top: 2px; }

  table.items { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  table.items th { background: ${accent}; color: #fff; padding: 7px 6px; font-size: 10.5px; text-align: center; }
  table.items td { border-bottom: 1px solid #e6e9ec; padding: 7px 6px; text-align: center; font-size: 11px; }
  table.items tr.alt td { background: #f2f7f4; }
  table.items td.desc { text-align: right; }
  table.items td.code { font-size: 9px; color: #7d8a94; }
  table.items td.amount { font-weight: 700; color: ${accent}; }

  .totals-wrap { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .totals { width: 300px; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed #e6e9ec; }
  .totals .grand { font-weight: 700; font-size: 15px; color: ${accent}; border-bottom: none; }
  .qr-wrap { text-align: center; font-size: 9.5px; color: #52606d; }
  .qr-wrap img { width: 110px; height: 110px; }

  table.bank { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  table.bank th { background: ${accent}; color: #fff; padding: 6px 8px; font-size: 10.5px; }
  table.bank td { border-bottom: 1px solid #e6e9ec; padding: 6px 8px; font-size: 11px; text-align: center; }

  .footer-bar { display: flex; justify-content: space-between; align-items: center; background: ${accent}; color: #fff; padding: 7px 14px; font-size: 10.5px; border-radius: 4px; margin-top: 10px; }
</style>
</head>
<body>
  <div class="head">
    <div class="head-title">${bi("فاتورة ضريبية", "Tax Invoice")}</div>
    <div class="head-company">
      <div class="head-company-ar">${escapeHtml(data.companyName)}</div>
      ${data.companyNameEn ? `<div class="head-company-en">${escapeHtml(data.companyNameEn)}</div>` : ""}
    </div>
    <div class="head-logo">${data.companyLogoDataUrl ? `<img src="${data.companyLogoDataUrl}" alt="${escapeHtml(data.companyName)}" />` : ""}</div>
  </div>

  <div class="parties">
    <div class="party-box">
      <div class="party-title">${bi("من / المورّد", "From / Seller")}</div>
      <div class="row"><span class="val">${escapeHtml(data.companyName)}</span></div>
      ${data.branchName ? `<div class="row">${bi("الفرع", "Branch")}: <span class="val">${escapeHtml(data.branchName)}</span></div>` : ""}
      ${data.companyVatNumber ? `<div class="row">${bi("الرقم الضريبي", "VAT")}: <span class="val">${escapeHtml(data.companyVatNumber)}</span></div>` : ""}
      ${data.companyUnifiedEntityNumber ? `<div class="row">${bi("الرقم الموحد للمنشأة", "Unified Entity No.")}: <span class="val">${escapeHtml(data.companyUnifiedEntityNumber)}</span></div>` : ""}
      ${data.companyLicenseNumber ? `<div class="row">${bi("رقم الترخيص", "License No.")}: <span class="val">${escapeHtml(data.companyLicenseNumber)}</span></div>` : ""}
      ${data.companyAddress ? `<div class="row">${escapeHtml(data.companyAddress)}</div>` : ""}
      ${data.companyPhone ? `<div class="row">${bi("هاتف", "Phone")}: <span class="val">${escapeHtml(data.companyPhone)}</span></div>` : ""}
    </div>
    <div class="party-box">
      <div class="party-title">${bi("إلى / العميل", "To / Customer")}</div>
      <div class="row"><span class="val">${escapeHtml(data.customerName)}</span></div>
      ${data.customerVatNumber ? `<div class="row">${bi("الرقم الضريبي", "VAT")}: <span class="val">${escapeHtml(data.customerVatNumber)}</span></div>` : ""}
      ${data.customerUnifiedEntityNumber ? `<div class="row">${bi("الرقم الموحد للمنشأة", "Unified Entity No.")}: <span class="val">${escapeHtml(data.customerUnifiedEntityNumber)}</span></div>` : ""}
      ${data.customerAddress ? `<div class="row">${escapeHtml(data.customerAddress)}</div>` : ""}
    </div>
  </div>

  <div class="info-bar">
    ${infoCell("رقم الفاتورة", "Invoice No.", data.documentNumber)}
    ${infoCell("تاريخ الفاتورة", "Invoice Date", data.issueDate)}
    ${infoCell("تاريخ الاستحقاق", "Due Date", data.dueDate)}
    ${infoCell("مرجع العميل", "Customer Ref.", data.customerReference)}
    ${infoCell("طلب الشراء", "P.O.", data.poNumber)}
    ${infoCell("البائع", "Salesman", data.salesperson)}
    ${infoCell("طريقة الدفع", "Payment Method", data.paymentMethod)}
    ${infoCell("معرف آخر", "Other ID", data.otherId)}
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>#</th><th>${bi("الوصف", "Description")}</th><th>${bi("الوحدة", "Unit")}</th><th>${bi("الكمية", "Qty")}</th>
        <th>${bi("السعر", "U.Price")}</th><th>${bi("الخصم %", "Disc %")}</th><th>${bi("المجموع", "Total")}</th>
        <th>${bi("الضريبة", "VAT")}</th><th>${bi("الإجمالي", "Amount")}</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="totals-wrap">
    <div class="qr-wrap">
      <img src="${data.qrDataUrl}" alt="ZATCA QR" />
      <div>${bi("امسح للتحقق", "Scan to verify")}</div>
    </div>
    <div class="totals">
      <div><span>${bi("الإجمالي قبل الضريبة", "Sub Total")}</span><span>${formatMoney(data.subtotal)}</span></div>
      <div><span>${bi("ضريبة القيمة المضافة", "VAT")}</span><span>${formatMoney(data.vatTotal)}</span></div>
      <div class="grand"><span>${bi("الإجمالي الكلي", "Total Due")}</span><span>${formatMoney(data.grandTotal)}</span></div>
      <div><span>${bi("المتبقي", "Remaining")}</span><span>${formatMoney(remaining)}</span></div>
    </div>
  </div>

  ${
    data.bankAccounts.length
      ? `<table class="bank">
          <thead><tr><th>${bi("اسم البنك", "Bank Name")}</th><th>${bi("رقم الحساب", "Account No.")}</th><th>${bi("رقم الآيبان", "IBAN")}</th></tr></thead>
          <tbody>${bankRowsHtml}</tbody>
        </table>`
      : ""
  }

  <div class="footer-bar">
    <span>${escapeHtml(data.issueDate)}</span>
    <span>${escapeHtml(data.companyName)}</span>
    <span>${bi("رقم الفاتورة", "Invoice No.")}: ${escapeHtml(data.documentNumber)}</span>
  </div>
</body>
</html>`;
}
