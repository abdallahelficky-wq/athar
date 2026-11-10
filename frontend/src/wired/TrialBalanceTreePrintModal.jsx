import TrialBalanceSummary from "./TrialBalanceSummary";
import React, { useState } from "react";
import "../styles/trial-balance.css";
import { flattenAllTree } from "./shared/trialBalanceTree";
import { useTranslation } from "react-i18next";
import { PrintShell } from "../legacy/shared";
import { fmt } from "../legacy/constants";
import { getAccountDisplayName } from "./shared/accountDisplayName";

/**
 * نسخة قابلة للطباعة من ميزان المراجعة الهرمي — تعرض بالضبط نفس الصفوف الظاهرة حالياً على الشاشة
 * (visibleRows مبنية من نفس expandedIds/hideZeroActivity/search المستخدَمة في الشاشة، انظر
 * ReportsModule) بنفس الترتيب والتداخل (indentation)، داخل PrintShell المشترك (شعار/بيانات
 * الشركة + اسم المستخدم وتاريخ الطباعة). الجدول عنصر <table> عادي بـ <thead> حقيقي فيتكرر رأس
 * الأعمدة تلقائياً في كل صفحة عبر آلية الطباعة الأصلية للمتصفح دون أي كود إضافي.
 */
export default function TrialBalanceTreePrintModal({ summary, roots, visibleRows, totals, balanced, dateFrom, dateTo, company, onClose }) {
  const { t, i18n } = useTranslation();
  // الافتراضي: كل الحسابات موسّعة (لا يضيع حساب لأن فرعه مطويّ في الشاشة)، مع خيار الطباعة كما يظهر على الشاشة
  const [scope, setScope] = useState("all");
  const rows = scope === "all" && roots ? flattenAllTree(roots) : visibleRows;
  const periodLabel = dateFrom || dateTo
    ? t("reports.trialPrint.periodWithDates", { from: dateFrom || t("reports.trialPrint.periodDefaultFrom"), to: dateTo || t("reports.trialPrint.periodDefaultTo") })
    : t("reports.trialPrint.periodAllTime");

  return (
    <PrintShell
      subtitle={t("nav.tabs.trial")}
      company={company}
      showSignatures={false}
      landscape
      outsidePrint={roots ? (
        <div className="form-btn-group" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          <label className="checkbox-label"><input type="radio" name="tb-print-scope" checked={scope === "all"} onChange={() => setScope("all")} /> {t("reports.trialPrint.scopeAll")}</label>
          <label className="checkbox-label"><input type="radio" name="tb-print-scope" checked={scope === "visible"} onChange={() => setScope("visible")} /> {t("reports.trialPrint.scopeVisible")}</label>
        </div>
      ) : null}
      refNode={<div>{periodLabel}</div>}
      onClose={onClose}
    >
      <div className="trial-print-summary"><TrialBalanceSummary summary={summary} company={company} compact /></div>
      <table className="ledger-table voucher-table tb-print-table">
        <thead>
          <tr>
            <th rowSpan={2}>{t("reports.trial.table.account")}</th>
            <th colSpan={2}>{t("reports.trial.table.openingBalance")}</th>
            <th colSpan={2}>{t("reports.trial.table.periodMovement")}</th>
            <th colSpan={2}>{t("reports.trial.table.closingBalance")}</th>
          </tr>
          <tr>
            <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th>
            <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th>
            <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, depth }) => (
            <tr key={node.accountId} className={!node.isPosting ? "strong" : ""}>
              <td style={{ paddingRight: 8 + depth * 18 }}>{node.code} — {getAccountDisplayName(node, i18n.language)}</td>
              <td className="num">{node.opening.debit ? fmt(node.opening.debit) : "—"}</td>
              <td className="num">{node.opening.credit ? fmt(node.opening.credit) : "—"}</td>
              <td className="num">{node.period.debit ? fmt(node.period.debit) : "—"}</td>
              <td className="num">{node.period.credit ? fmt(node.period.credit) : "—"}</td>
              <td className="num">{node.closing.debit ? fmt(node.closing.debit) : "—"}</td>
              <td className="num">{node.closing.credit ? fmt(node.closing.credit) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="foot-label">{t("reports.trial.totalLabel")}</td>
            <td className="num strong">{fmt(totals.openingDebit)}</td>
            <td className="num strong">{fmt(totals.openingCredit)}</td>
            <td className="num strong">{fmt(totals.periodDebit)}</td>
            <td className="num strong">{fmt(totals.periodCredit)}</td>
            <td className="num strong">{fmt(totals.closingDebit)}</td>
            <td className="num strong">{fmt(totals.closingCredit)} {balanced ? "✓" : "⚠"}</td>
          </tr>
        </tfoot>
      </table>
      <p style={{fontSize:10,color:"#64748b"}}>{t("trialDesign.totalScope")}</p>
    </PrintShell>
  );
}
