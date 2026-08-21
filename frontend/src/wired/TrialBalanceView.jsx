import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { fmt } from "../legacy/constants";
import { collectGroupAccountIds, flattenVisibleTree } from "./shared/trialBalanceTree";

/**
 * ميزان مراجعة هرمي (Tree View) — بنفس شكل شجرة الحسابات: كل حساب أب (مستوى 1-3) صف إجمالي
 * تلقائي لكل ما تحته، متداخل (indented) فوق أبنائه وصولاً لحسابات الترحيل الفعلية في الأوراق.
 * الشجرة مبنية مسبقاً من الخادم (getTrialBalanceTree) بإجماليات تصاعدية جاهزة على كل عقدة —
 * هذا المكوّن مسؤول فقط عن عرضها وطي/فتح فروعها، وحالة الطي (expandedIds) مرفوعة للأب
 * (ReportsModule) حتى تُستخدَم نفسها بالضبط عند الطباعة والتصدير (نفس الصفوف الظاهرة تماماً).
 */
export default function TrialBalanceView({
  data,
  filters,
  expandedIds, setExpandedIds,
  onPrint, onExportExcel,
  branches,
}) {
  const { t } = useTranslation();
  const { draft, setField, apply } = filters;
  const allGroupIds = useMemo(() => (data ? collectGroupAccountIds(data.roots) : new Set()), [data]);
  const visibleRows = useMemo(() => (data ? flattenVisibleTree(data.roots, expandedIds) : []), [data, expandedIds]);

  if (!data) return null;

  const toggle = (id) => setExpandedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const expandAll = () => setExpandedIds(new Set(allGroupIds));
  const collapseAll = () => setExpandedIds(new Set());

  return (
    <div className="panel">
      <div className="form-btn-group" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>{t("nav.tabs.trial")}</h3>
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onExportExcel}>{t("reports.trial.downloadExcel")}</button>
          <button className="btn-ghost" onClick={onPrint}>{t("common.print")}</button>
        </div>
      </div>

      <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label>{t("reports.trial.fromDate")}<input type="date" value={draft.dateFrom} onChange={(e) => setField("dateFrom", e.target.value)} /></label>
        <label>{t("reports.trial.toDate")}<input type="date" value={draft.dateTo} onChange={(e) => setField("dateTo", e.target.value)} /></label>
        {branches && branches.length > 0 && (
          <label>
            {t("reports.rollupFilter.branchLabel")}
            <select value={draft.branchId || ""} onChange={(e) => setField("branchId", e.target.value)}>
              <option value="">{t("reports.rollupFilter.allBranches")}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
            </select>
          </label>
        )}
        <label>
          {t("reports.trial.levelLabel")}
          <select value={draft.level} onChange={(e) => setField("level", Number(e.target.value))}>
            <option value={1}>{t("chartOfAccounts.filters.level1")}</option>
            <option value={2}>{t("chartOfAccounts.filters.level2")}</option>
            <option value={3}>{t("chartOfAccounts.filters.level3")}</option>
            <option value={4}>{t("chartOfAccounts.filters.level4Full")}</option>
          </select>
        </label>
        <label>{t("chartOfAccounts.filters.searchLabel")}<input type="text" value={draft.search} onChange={(e) => setField("search", e.target.value)} placeholder={t("reports.trial.searchPlaceholder")} /></label>
        <label className="checkbox-label" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={draft.hideZeroActivity} onChange={(e) => setField("hideZeroActivity", e.target.checked)} />
          {t("reports.trial.hideZeroActivity")}
        </label>
        <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>{t("reports.trial.showResults")}</button>
      </form>

      <div className="form-btn-group" style={{ marginBottom: 10 }}>
        <button className="btn-ghost" onClick={expandAll}>{t("reports.trial.expandAll")}</button>
        <button className="btn-ghost" onClick={collapseAll}>{t("reports.trial.collapseAll")}</button>
      </div>

      <div className="lines-table-wrap">
        <table className="ledger-table responsive-table">
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
            {visibleRows.map(({ node, depth }) => {
              const isGroup = !node.isPosting;
              const isExpanded = expandedIds.has(node.accountId);
              return (
                <tr key={node.accountId} className={"tb-tree-row" + (isGroup ? " tb-group" : "")}>
                  <td data-label={t("reports.trial.table.account")}>
                    <div className="tb-tree-name-cell" style={{ paddingRight: depth * 22 }}>
                      <button
                        type="button"
                        className={"tb-tree-toggle" + (!isExpanded ? " tb-collapsed" : "")}
                        disabled={node.children.length === 0}
                        onClick={() => toggle(node.accountId)}
                      >▾</button>
                      {node.code} — {node.name}
                    </div>
                  </td>
                  <td className="num" data-label={t("statementOfAccount.table.debit")}>{node.opening.debit ? fmt(node.opening.debit) : "—"}</td>
                  <td className="num" data-label={t("statementOfAccount.table.credit")}>{node.opening.credit ? fmt(node.opening.credit) : "—"}</td>
                  <td className="num" data-label={t("statementOfAccount.table.debit")}>{node.period.debit ? fmt(node.period.debit) : "—"}</td>
                  <td className="num" data-label={t("statementOfAccount.table.credit")}>{node.period.credit ? fmt(node.period.credit) : "—"}</td>
                  <td className="num" data-label={t("statementOfAccount.table.debit")}>{node.closing.debit ? fmt(node.closing.debit) : "—"}</td>
                  <td className="num" data-label={t("statementOfAccount.table.credit")}>{node.closing.credit ? fmt(node.closing.credit) : "—"}</td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && <tr><td className="empty" colSpan={7}>{t("reports.trial.empty")}</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label">{t("reports.trial.totalLabel")}</td>
              <td className="num strong">{fmt(data.totals.openingDebit)}</td>
              <td className="num strong">{fmt(data.totals.openingCredit)}</td>
              <td className="num strong">{fmt(data.totals.periodDebit)}</td>
              <td className="num strong">{fmt(data.totals.periodCredit)}</td>
              <td className="num strong">{fmt(data.totals.closingDebit)}</td>
              <td className={"num strong " + (data.balanced ? "balance-ok" : "balance-bad")}>
                {fmt(data.totals.closingCredit)} {data.balanced ? "✓" : `⚠ ${t("reports.trial.unbalanced")}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
