// قالب HTML لطباعة فاتورة/إشعار زاتكا إلى PDF (عبر Puppeteer) — يعكس نفس لغة التصميم البصري
// المستخدَمة في PrintShell بالواجهة الأمامية (frontend/src/legacy/shared.jsx): رأس بثلاثة أعمدة
// (مرجع المستند يميناً، شعار في المنتصف، بيانات الشركة يساراً)، جدول أسطر، صناديق توقيع، وQR.
// مُستقلّ تماماً عن React — نص HTML خام مع CSS مضمّن، لأن العرض يتم من الخادم لا المتصفح.

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  vat: number;
  total: number;
}

export interface InvoicePdfData {
  documentTitleAr: string; // "فاتورة ضريبية" / "إشعار دائن" / "إشعار مدين"
  documentNumber: string;
  issueDate: string; // YYYY-MM-DD
  companyName: string;
  companyVatNumber?: string | null;
  companyAddress?: string | null;
  companyLogoDataUrl?: string | null;
  brandColor?: string | null;
  customerName: string;
  customerVatNumber?: string | null;
  lines: InvoicePdfLine[];
  subtotal: number;
  vatTotal: number;
  grandTotal: number;
  qrDataUrl: string;
  zatcaUuid: string;
}

export function buildInvoiceHtml(data: InvoicePdfData): string {
  const accent = data.brandColor || "#10202E";
  const rowsHtml = data.lines
    .map(
      (l, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(l.description)}</td>
          <td class="num">${l.quantity}</td>
          <td class="num">${formatMoney(l.unitPrice)}</td>
          <td class="num">${formatMoney(l.subtotal)}</td>
          <td class="num">${formatMoney(l.vat)}</td>
          <td class="num">${formatMoney(l.total)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.documentTitleAr)} ${escapeHtml(data.documentNumber)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #10202E; margin: 0; direction: rtl; }
  .head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; border-bottom: 3px solid ${accent}; padding-bottom: 12px; margin-bottom: 16px; }
  .ref div { margin-bottom: 4px; font-size: 13px; }
  .logo-wrap { text-align: center; }
  .logo-wrap img { max-height: 60px; max-width: 140px; }
  .company-info { text-align: left; font-size: 13px; }
  .brand-name { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  .meta-row { display: flex; justify-content: space-between; margin-bottom: 14px; font-size: 13px; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
  table.lines th, table.lines td { border: 1px solid #ccc; padding: 6px 8px; text-align: right; }
  table.lines th { background: #f2f4f7; }
  td.num, th.num { text-align: left; font-variant-numeric: tabular-nums; }
  .totals { width: 260px; margin-right: auto; font-size: 13px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { font-weight: 700; border-top: 2px solid ${accent}; margin-top: 4px; padding-top: 8px; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 24px; }
  .qr img { width: 120px; height: 120px; }
  .signatures { display: flex; gap: 24px; margin-top: 40px; }
  .sig-box { flex: 1; text-align: center; font-size: 12px; }
  .sig-line { border-top: 1px solid #999; margin-top: 30px; }
  .uuid { font-size: 10px; color: #667; margin-top: 8px; word-break: break-all; }
</style>
</head>
<body>
  <div class="head">
    <div class="ref">
      <div>رقم المستند: <strong>${escapeHtml(data.documentNumber)}</strong></div>
      <div>التاريخ: <strong>${escapeHtml(data.issueDate)}</strong></div>
    </div>
    <div class="logo-wrap">
      ${data.companyLogoDataUrl ? `<img src="${data.companyLogoDataUrl}" alt="${escapeHtml(data.companyName)}" />` : `<div class="brand-name">${escapeHtml(data.companyName)}</div>`}
    </div>
    <div class="company-info">
      <div class="brand-name">${escapeHtml(data.companyName)}</div>
      ${data.companyVatNumber ? `<div>الرقم الضريبي: ${escapeHtml(data.companyVatNumber)}</div>` : ""}
      ${data.companyAddress ? `<div>${escapeHtml(data.companyAddress)}</div>` : ""}
    </div>
  </div>

  <h2>${escapeHtml(data.documentTitleAr)}</h2>
  <div class="meta-row">
    <div>العميل: <strong>${escapeHtml(data.customerName)}</strong>${data.customerVatNumber ? ` — الرقم الضريبي: ${escapeHtml(data.customerVatNumber)}` : ""}</div>
  </div>

  <table class="lines">
    <thead>
      <tr><th>#</th><th>البيان</th><th class="num">الكمية</th><th class="num">سعر الوحدة</th><th class="num">الصافي</th><th class="num">الضريبة</th><th class="num">الإجمالي</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="totals">
    <div><span>الإجمالي قبل الضريبة</span><span>${formatMoney(data.subtotal)}</span></div>
    <div><span>ضريبة القيمة المضافة</span><span>${formatMoney(data.vatTotal)}</span></div>
    <div class="grand"><span>الإجمالي شامل الضريبة</span><span>${formatMoney(data.grandTotal)}</span></div>
  </div>

  <div class="footer">
    <div class="signatures" style="flex:1">
      <div class="sig-box">أعدّه<div class="sig-line"></div></div>
      <div class="sig-box">اعتمده<div class="sig-line"></div></div>
    </div>
    <div class="qr">
      <img src="${data.qrDataUrl}" alt="QR" />
      <div class="uuid">${escapeHtml(data.zatcaUuid)}</div>
    </div>
  </div>
</body>
</html>`;
}
