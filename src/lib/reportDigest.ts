import { prisma } from "./prisma";
import { notFound } from "./httpError";
import * as reportsService from "../modules/reports/reports.service";
import { Lang } from "./i18n/translate";

export interface ReportDigestOptions {
  includeComprehensiveMonthly: boolean;
  includeTrialBalance: boolean;
  includeIncomeStatement: boolean;
  includeBalanceSheet: boolean;
}

const money = (n: number, lang: Lang = "ar") =>
  (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString(lang === "en" ? "en-US" : "ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const badgeStyle = (positive: boolean) =>
  `color:${positive ? "#1a7a4c" : "#b3261e"}; font-weight:600;`;

function sectionShell(title: string, bodyHtml: string): string {
  return `
    <div style="margin-bottom:28px; border:1px solid rgba(16,32,46,0.12); border-radius:10px; overflow:hidden;">
      <div style="background:#10202E; color:#ECE6D6; padding:10px 16px; font-weight:700; font-size:14px;">${title}</div>
      <div style="padding:16px;">${bodyHtml}</div>
    </div>
  `;
}

function statRow(label: string, value: string, extraStyle = ""): string {
  return `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(16,32,46,0.06); font-size:13px;">
      <span style="color:#5c6b78;">${label}</span>
      <span style="${extraStyle}">${value}</span>
    </div>
  `;
}

function renderComprehensiveSection(report: Awaited<ReturnType<typeof reportsService.getComprehensiveMonthlyReport>>, lang: Lang): string {
  const en = lang === "en";
  const comparisonRows = report.comparison
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06);">${row.label}</td>
          <td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06); text-align:left;">${money(row.current, lang)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06); text-align:left; color:#8A7C5E;">${money(row.previous, lang)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06); text-align:left; ${badgeStyle(row.difference >= 0)}">
            ${row.difference >= 0 ? "+" : ""}${money(row.difference, lang)}${row.changePct != null ? ` (${row.changePct > 0 ? "+" : ""}${row.changePct}%)` : ""}
          </td>
        </tr>`,
    )
    .join("");

  const notesHtml = report.generatedNotes.length
    ? `<div style="margin-top:14px; background:#fdf3e7; border:1px solid #e8c99a; border-radius:8px; padding:10px 14px;">
        <div style="font-weight:700; font-size:13px; margin-bottom:6px; color:#8a5a00;">${en ? "This month's alerts" : "تنبيهات هذا الشهر"}</div>
        ${report.generatedNotes.map((n) => `<div style="font-size:12.5px; color:#6b4a00; padding:2px 0;">• ${n}</div>`).join("")}
      </div>`
    : "";

  return sectionShell(
    en ? `Comprehensive Monthly Summary — ${report.month}` : `الملخص الشهري الشامل — ${report.month}`,
    `
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="color:#5c6b78; text-align:right;">
            <th style="padding:6px 8px; text-align:right;">${en ? "Metric" : "المؤشر"}</th>
            <th style="padding:6px 8px; text-align:left;">${en ? "Current month" : "الشهر الحالي"}</th>
            <th style="padding:6px 8px; text-align:left;">${en ? "Previous month" : "الشهر السابق"}</th>
            <th style="padding:6px 8px; text-align:left;">${en ? "Difference" : "الفرق"}</th>
          </tr>
        </thead>
        <tbody>${comparisonRows}</tbody>
      </table>
      ${statRow(en ? "Total current cash" : "إجمالي النقدية الحالي", money(report.totalCash, lang))}
      ${statRow(en ? "Total receivables" : "إجمالي الذمم المدينة", money(report.receivables.total, lang))}
      ${statRow(en ? "Total payables" : "إجمالي الذمم الدائنة", money(report.payables.total, lang))}
      ${notesHtml}
    `,
  );
}

function renderTotalsSection(
  title: string,
  rows: { label: string; value: number; style?: string }[],
  lang: Lang,
  footer?: string,
): string {
  return sectionShell(
    title,
    `
      ${rows.map((r) => statRow(r.label, money(r.value, lang), r.style)).join("")}
      ${footer ? `<div style="margin-top:10px; font-size:12px; color:#8A7C5E;">${footer}</div>` : ""}
    `,
  );
}

/** يبني محتوى رسالة التقرير المالي الدوري (الموضوع + HTML) — يُستخدَم من مسار "إرسال الآن"
 * ومن المُجدوِل التلقائي (reportScheduler.ts) معاً حتى يبقى شكل المحتوى موحّداً بينهما. */
export async function buildReportDigestEmail(tenantId: string, companyId: string, options: ReportDigestOptions, lang: Lang = "ar") {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw notFound("الشركة المحددة غير موجودة ضمن مستأجرك");
  const en = lang === "en";
  const locale = en ? "en-GB" : "ar-EG";

  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sections: string[] = [];

  if (options.includeComprehensiveMonthly) {
    const report = await reportsService.getComprehensiveMonthlyReport(tenantId, companyId, month, lang);
    sections.push(renderComprehensiveSection(report, lang));
  }
  if (options.includeIncomeStatement) {
    const report = await reportsService.getIncomeStatement(tenantId, companyId, monthStart, now, {});
    sections.push(
      renderTotalsSection(en ? "Income statement (since the start of this month)" : "قائمة الدخل (منذ بداية الشهر الحالي)", [
        { label: en ? "Total revenue" : "إجمالي الإيرادات", value: report.totalRevenue },
        { label: en ? "Total expenses" : "إجمالي المصروفات", value: report.totalExpense },
        { label: en ? "Net income" : "صافي الدخل", value: report.netIncome, style: badgeStyle(report.netIncome >= 0) },
      ], lang),
    );
  }
  if (options.includeBalanceSheet) {
    const report = await reportsService.getBalanceSheet(tenantId, companyId, now, {});
    sections.push(
      renderTotalsSection(en ? "Financial position (as of today)" : "المركز المالي (حتى تاريخ اليوم)", [
        { label: en ? "Total assets" : "إجمالي الأصول", value: report.totalAssets },
        { label: en ? "Total liabilities" : "إجمالي الالتزامات", value: report.totalLiabilities },
        { label: en ? "Total equity" : "إجمالي حقوق الملكية", value: report.totalEquity },
      ], lang, report.balanced
        ? (en ? "The balance sheet is balanced." : "الميزانية متوازنة.")
        : (en ? "⚠ The balance sheet is not balanced — worth reviewing." : "⚠ الميزانية غير متوازنة — يستحق مراجعة.")),
    );
  }
  if (options.includeTrialBalance) {
    const report = await reportsService.getTrialBalanceReport(tenantId, companyId, undefined, now, {});
    sections.push(
      renderTotalsSection(en ? "Trial balance (as of today)" : "ميزان المراجعة (حتى تاريخ اليوم)", [
        { label: en ? "Total closing debit" : "إجمالي مدين ختامي", value: report.totals.closingDebit },
        { label: en ? "Total closing credit" : "إجمالي دائن ختامي", value: report.totals.closingCredit },
      ], lang, report.balanced
        ? (en ? "The trial balance is balanced." : "الميزان متوازن.")
        : (en ? "⚠ The trial balance is not balanced — worth reviewing." : "⚠ الميزان غير متوازن — يستحق مراجعة.")),
    );
  }

  if (!sections.length) {
    sections.push(`<p style="font-size:13px; color:#5c6b78;">${en ? "No report was selected to send in this schedule's settings." : "لم يُحدَّد أي تقرير للإرسال ضمن إعدادات هذه الجدولة."}</p>`);
  }

  return {
    companyName: company.name,
    subject: en
      ? `Periodic Financial Report — ${company.name} — ${now.toLocaleDateString(locale)}`
      : `التقرير المالي الدوري — ${company.name} — ${now.toLocaleDateString(locale)}`,
    bodyHtml: `
      <h2 style="color:#10202E; margin-bottom:4px;">${en ? "Periodic Financial Report" : "التقرير المالي الدوري"}</h2>
      <p style="color:#5c6b78; font-size:13px; margin-top:0;">${company.name} — ${now.toLocaleDateString(locale)}</p>
      ${sections.join("")}
    `,
  };
}
