import React, { useMemo } from "react";
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
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  hideZeroActivity, setHideZeroActivity,
  search, setSearch,
  expandedIds, setExpandedIds,
  onPrint, onExportExcel,
}) {
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
        <h3 style={{ margin: 0 }}>ميزان المراجعة</h3>
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onExportExcel}>تحميل Excel</button>
          <button className="btn-ghost" onClick={onPrint}>طباعة</button>
        </div>
      </div>

      <div className="filter-bar">
        <label>من تاريخ<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label>إلى تاريخ<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <label>بحث بالاسم أو الكود<input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث..." /></label>
        <label className="checkbox-label" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={hideZeroActivity} onChange={(e) => setHideZeroActivity(e.target.checked)} />
          إخفاء الحسابات بدون حركة
        </label>
      </div>

      <div className="form-btn-group" style={{ marginBottom: 10 }}>
        <button className="btn-ghost" onClick={expandAll}>فتح الكل</button>
        <button className="btn-ghost" onClick={collapseAll}>طي الكل</button>
      </div>

      <div className="lines-table-wrap">
        <table className="ledger-table responsive-table">
          <thead>
            <tr>
              <th rowSpan={2}>الحساب</th>
              <th colSpan={2}>الرصيد الافتتاحي</th>
              <th colSpan={2}>حركة الفترة</th>
              <th colSpan={2}>الرصيد الختامي</th>
            </tr>
            <tr>
              <th>مدين</th><th>دائن</th>
              <th>مدين</th><th>دائن</th>
              <th>مدين</th><th>دائن</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ node, depth }) => {
              const isGroup = !node.isPosting;
              const isExpanded = expandedIds.has(node.accountId);
              return (
                <tr key={node.accountId} className={"tb-tree-row" + (isGroup ? " tb-group" : "")}>
                  <td data-label="الحساب">
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
                  <td className="num" data-label="افتتاحي مدين">{node.opening.debit ? fmt(node.opening.debit) : "—"}</td>
                  <td className="num" data-label="افتتاحي دائن">{node.opening.credit ? fmt(node.opening.credit) : "—"}</td>
                  <td className="num" data-label="حركة مدين">{node.period.debit ? fmt(node.period.debit) : "—"}</td>
                  <td className="num" data-label="حركة دائن">{node.period.credit ? fmt(node.period.credit) : "—"}</td>
                  <td className="num" data-label="ختامي مدين">{node.closing.debit ? fmt(node.closing.debit) : "—"}</td>
                  <td className="num" data-label="ختامي دائن">{node.closing.credit ? fmt(node.closing.credit) : "—"}</td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && <tr><td className="empty" colSpan={7}>لا توجد حسابات مطابقة لهذا الفلتر.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label">الإجمالي العام</td>
              <td className="num strong">{fmt(data.totals.openingDebit)}</td>
              <td className="num strong">{fmt(data.totals.openingCredit)}</td>
              <td className="num strong">{fmt(data.totals.periodDebit)}</td>
              <td className="num strong">{fmt(data.totals.periodCredit)}</td>
              <td className="num strong">{fmt(data.totals.closingDebit)}</td>
              <td className={"num strong " + (data.balanced ? "balance-ok" : "balance-bad")}>
                {fmt(data.totals.closingCredit)} {data.balanced ? "✓" : "⚠ غير متوازن"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
