import { renderHtmlToPdf } from "./zatca/pdf/renderPdf";

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

export interface JournalVoucherPdfLine {
  accountLabel: string;
  costCenterLabel: string;
  departmentLabel: string;
  branchLabel: string | null;
  description: string;
  debit: number;
  credit: number;
}

export interface JournalVoucherPdfInput {
  entryNumber: string;
  date: string; // YYYY-MM-DD
  memo: string | null;
  statusLabel: string;
  companyName: string;
  brandColor?: string | null;
  lines: JournalVoucherPdfLine[];
  hasBranchColumn: boolean;
}

/**
 * قالب HTML لطباعة سند قيد محاسبي إلى PDF (عبر Puppeteer، نفس آلية buildInvoiceHtml/renderHtmlToPdf
 * المستخدَمة أصلاً لفواتير المبيعات) — مستند داخلي بالعربية فقط (بخلاف الفاتورة الضريبية، لا يخضع
 * لإلزامية ثنائية اللغة القانونية)، بلا شعار الشركة (يتطلب جلب صورة عن بُعد وتحويلها base64 —
 * نفس القرار المتّبَع أصلاً في buildPlainInvoicePdf لتفادي أي اعتماد على شبكة خارجية أثناء التصيير).
 */
function buildJournalVoucherHtml(data: JournalVoucherPdfInput): string {
  const accent = data.brandColor || "#10202E";
  const rowsHtml = data.lines
    .map(
      (l) => `
        <tr>
          <td>${escapeHtml(l.accountLabel)}</td>
          <td>${escapeHtml(l.costCenterLabel)}</td>
          <td>${escapeHtml(l.departmentLabel)}</td>
          ${data.hasBranchColumn ? `<td>${escapeHtml(l.branchLabel || "—")}</td>` : ""}
          <td>${escapeHtml(l.description)}</td>
          <td class="num">${l.debit ? formatMoney(l.debit) : "—"}</td>
          <td class="num">${l.credit ? formatMoney(l.credit) : "—"}</td>
        </tr>`,
    )
    .join("");
  const total = data.lines.reduce((s, l) => s + l.debit, 0);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>سند قيد محاسبي ${escapeHtml(data.entryNumber)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #10202E; margin: 0; direction: rtl; }
  .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${accent}; padding-bottom: 12px; margin-bottom: 16px; }
  .ref div { margin-bottom: 4px; font-size: 13px; }
  .brand-name { font-size: 16px; font-weight: 700; }
  .subtitle { font-size: 12px; color: #667; }
  .meta-row { display: flex; justify-content: space-between; margin-bottom: 14px; font-size: 13px; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
  table.lines th, table.lines td { border: 1px solid #ccc; padding: 6px 8px; text-align: right; }
  table.lines th { background: #f2f4f7; }
  td.num, th.num { text-align: left; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; border-top: 2px solid ${accent}; }
  .signatures { display: flex; gap: 24px; margin-top: 40px; }
  .sig-box { flex: 1; text-align: center; font-size: 12px; }
  .sig-line { border-top: 1px solid #999; margin-top: 30px; }
  .footer-note { margin-top: 24px; font-size: 10px; color: #667; text-align: left; }
</style>
</head>
<body>
  <div class="head">
    <div class="ref">
      <div>رقم القيد: <strong>${escapeHtml(data.entryNumber)}</strong></div>
      <div>التاريخ: <strong>${escapeHtml(data.date)}</strong></div>
    </div>
    <div>
      <div class="brand-name">${escapeHtml(data.companyName)}</div>
      <div class="subtitle">سند قيد محاسبي</div>
    </div>
  </div>

  <div class="meta-row">
    <div>البيان: <strong>${escapeHtml(data.memo || "بدون بيان")}</strong></div>
    <div>الحالة: <strong>${escapeHtml(data.statusLabel)}</strong></div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th>الحساب</th><th>مركز التكلفة</th><th>القسم</th>
        ${data.hasBranchColumn ? "<th>الفرع</th>" : ""}
        <th>الوصف</th><th class="num">مدين</th><th class="num">دائن</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="${data.hasBranchColumn ? 4 : 3}">الإجمالي</td>
        <td></td>
        <td class="num">${formatMoney(total)}</td>
        <td class="num">${formatMoney(total)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="signatures">
    <div class="sig-box">أعدّه<div class="sig-line"></div></div>
    <div class="sig-box">اعتمده<div class="sig-line"></div></div>
    <div class="sig-box">الختم<div class="sig-line"></div></div>
  </div>

  <div class="footer-note">تاريخ إصدار الملف: ${escapeHtml(new Date().toLocaleString("ar-SA"))}</div>
</body>
</html>`;
}

export function buildJournalVoucherPdf(data: JournalVoucherPdfInput): Promise<Buffer> {
  return renderHtmlToPdf(buildJournalVoucherHtml(data));
}
