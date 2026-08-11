import { prisma } from "./prisma";
import { notFound } from "./httpError";
import * as reportsService from "../modules/reports/reports.service";

export interface ReportDigestOptions {
  includeComprehensiveMonthly: boolean;
  includeTrialBalance: boolean;
  includeIncomeStatement: boolean;
  includeBalanceSheet: boolean;
}

const money = (n: number) =>
  (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

function renderComprehensiveSection(report: Awaited<ReturnType<typeof reportsService.getComprehensiveMonthlyReport>>): string {
  const comparisonRows = report.comparison
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06);">${row.label}</td>
          <td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06); text-align:left;">${money(row.current)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06); text-align:left; color:#8A7C5E;">${money(row.previous)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06); text-align:left; ${badgeStyle(row.difference >= 0)}">
            ${row.difference >= 0 ? "+" : ""}${money(row.difference)}${row.changePct != null ? ` (${row.changePct > 0 ? "+" : ""}${row.changePct}%)` : ""}
          </td>
        </tr>`,
    )
    .join("");

  const notesHtml = report.generatedNotes.length
    ? `<div style="margin-top:14px; background:#fdf3e7; border:1px solid #e8c99a; border-radius:8px; padding:10px 14px;">
        <div style="font-weight:700; font-size:13px; margin-bottom:6px; color:#8a5a00;">تنبيهات هذا الشهر</div>
        ${report.generatedNotes.map((n) => `<div style="font-size:12.5px; color:#6b4a00; padding:2px 0;">• ${n}</div>`).join("")}
      </div>`
    : "";

  return sectionShell(
    `الملخص الشهري الشامل — ${report.month}`,
    `
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="color:#5c6b78; text-align:right;">
            <th style="padding:6px 8px; text-align:right;">المؤشر</th>
            <th style="padding:6px 8px; text-align:left;">الشهر الحالي</th>
            <th style="padding:6px 8px; text-align:left;">الشهر السابق</th>
            <th style="padding:6px 8px; text-align:left;">الفرق</th>
          </tr>
        </thead>
        <tbody>${comparisonRows}</tbody>
      </table>
      ${statRow("إجمالي النقدية الحالي", money(report.totalCash))}
      ${statRow("إجمالي الذمم المدينة", money(report.receivables.total))}
      ${statRow("إجمالي الذمم الدائنة", money(report.payables.total))}
      ${notesHtml}
    `,
  );
}

function renderTotalsSection(
  title: string,
  rows: { label: string; value: number; style?: string }[],
  footer?: string,
): string {
  return sectionShell(
    title,
    `
      ${rows.map((r) => statRow(r.label, money(r.value), r.style)).join("")}
      ${footer ? `<div style="margin-top:10px; font-size:12px; color:#8A7C5E;">${footer}</div>` : ""}
    `,
  );
}

/** يبني محتوى رسالة التقرير المالي الدوري (الموضوع + HTML) — يُستخدَم من مسار "إرسال الآن"
 * ومن المُجدوِل التلقائي (reportScheduler.ts) معاً حتى يبقى شكل المحتوى موحّداً بينهما. */
export async function buildReportDigestEmail(tenantId: string, companyId: string, options: ReportDigestOptions) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw notFound("الشركة المحددة غير موجودة ضمن مستأجرك");

  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sections: string[] = [];

  if (options.includeComprehensiveMonthly) {
    const report = await reportsService.getComprehensiveMonthlyReport(tenantId, companyId, month);
    sections.push(renderComprehensiveSection(report));
  }
  if (options.includeIncomeStatement) {
    const report = await reportsService.getIncomeStatement(tenantId, companyId, monthStart, now, {});
    sections.push(
      renderTotalsSection("قائمة الدخل (منذ بداية الشهر الحالي)", [
        { label: "إجمالي الإيرادات", value: report.totalRevenue },
        { label: "إجمالي المصروفات", value: report.totalExpense },
        { label: "صافي الدخل", value: report.netIncome, style: badgeStyle(report.netIncome >= 0) },
      ]),
    );
  }
  if (options.includeBalanceSheet) {
    const report = await reportsService.getBalanceSheet(tenantId, companyId, now, {});
    sections.push(
      renderTotalsSection("المركز المالي (حتى تاريخ اليوم)", [
        { label: "إجمالي الأصول", value: report.totalAssets },
        { label: "إجمالي الالتزامات", value: report.totalLiabilities },
        { label: "إجمالي حقوق الملكية", value: report.totalEquity },
      ], report.balanced ? "الميزانية متوازنة." : "⚠ الميزانية غير متوازنة — يستحق مراجعة."),
    );
  }
  if (options.includeTrialBalance) {
    const report = await reportsService.getTrialBalanceReport(tenantId, companyId, undefined, now, {});
    sections.push(
      renderTotalsSection("ميزان المراجعة (حتى تاريخ اليوم)", [
        { label: "إجمالي مدين ختامي", value: report.totals.closingDebit },
        { label: "إجمالي دائن ختامي", value: report.totals.closingCredit },
      ], report.balanced ? "الميزان متوازن." : "⚠ الميزان غير متوازن — يستحق مراجعة."),
    );
  }

  if (!sections.length) {
    sections.push(`<p style="font-size:13px; color:#5c6b78;">لم يُحدَّد أي تقرير للإرسال ضمن إعدادات هذه الجدولة.</p>`);
  }

  return {
    companyName: company.name,
    subject: `التقرير المالي الدوري — ${company.name} — ${now.toLocaleDateString("ar-EG")}`,
    bodyHtml: `
      <h2 style="color:#10202E; margin-bottom:4px;">التقرير المالي الدوري</h2>
      <p style="color:#5c6b78; font-size:13px; margin-top:0;">${company.name} — ${now.toLocaleDateString("ar-EG")}</p>
      ${sections.join("")}
    `,
  };
}
