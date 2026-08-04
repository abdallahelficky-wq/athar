import React from "react";
import { fmt } from "../legacy/constants";
import { downloadCsv } from "../legacy/shared";
import ReportRollupFilter from "./shared/ReportRollupFilter";

/**
 * ميزان مراجعة محاسبي كامل: لكل حساب (أو مجموعة، حسب المستوى/الفلتر المختار) — رصيد افتتاحي،
 * حركة الفترة (مدين/دائن خام)، ورصيد ختامي، كل واحد مقسوم مدين/دائن حسب صافي القيمة (موجب = مدين،
 * سالب = دائن) لا حسب الجانب الطبيعي لنوع الحساب — التعريف القياسي لميزان المراجعة الذي يتيح
 * التحقق من التوازن عند كل عمود على حدة.
 */
export default function TrialBalanceView({ accounts, data, dateFrom, setDateFrom, dateTo, setDateTo, level, setLevel, accountId, setAccountId, includeDetails, setIncludeDetails, search, setSearch }) {
  if (!data) return null;

  const displayRows = data.rows.filter(
    (r) => r.opening.debit || r.opening.credit || r.period.debit || r.period.credit || r.closing.debit || r.closing.credit,
  );

  const exportCsv = () => {
    downloadCsv("ميزان_المراجعة.csv", [
      ["الكود", "الحساب", "افتتاحي مدين", "افتتاحي دائن", "حركة مدين", "حركة دائن", "ختامي مدين", "ختامي دائن"],
      ...displayRows.map((r) => [r.code, r.name, r.opening.debit, r.opening.credit, r.period.debit, r.period.credit, r.closing.debit, r.closing.credit]),
      ["الإجمالي", "", data.totals.openingDebit, data.totals.openingCredit, data.totals.periodDebit, data.totals.periodCredit, data.totals.closingDebit, data.totals.closingCredit],
    ]);
  };

  return (
    <div className="panel">
      <div className="form-btn-group" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>ميزان المراجعة</h3>
        <button className="btn-ghost" onClick={exportCsv}>تصدير Excel/CSV</button>
      </div>

      <div className="filter-bar">
        <label>من تاريخ<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label>إلى تاريخ<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
      </div>
      <ReportRollupFilter
        accounts={accounts}
        level={level} onLevelChange={setLevel}
        accountId={accountId} onAccountChange={setAccountId}
        includeDetails={includeDetails} onIncludeDetailsChange={setIncludeDetails}
        search={search} onSearchChange={setSearch}
      />

      <div className="lines-table-wrap">
        <table className="ledger-table responsive-table">
          <thead>
            <tr>
              <th rowSpan={2}>الكود</th>
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
            {displayRows.map((r) => (
              <tr key={r.accountId}>
                <td data-label="الكود">{r.code}</td>
                <td data-label="الحساب">{r.name}</td>
                <td className="num" data-label="افتتاحي مدين">{r.opening.debit ? fmt(r.opening.debit) : "—"}</td>
                <td className="num" data-label="افتتاحي دائن">{r.opening.credit ? fmt(r.opening.credit) : "—"}</td>
                <td className="num" data-label="حركة مدين">{r.period.debit ? fmt(r.period.debit) : "—"}</td>
                <td className="num" data-label="حركة دائن">{r.period.credit ? fmt(r.period.credit) : "—"}</td>
                <td className="num" data-label="ختامي مدين">{r.closing.debit ? fmt(r.closing.debit) : "—"}</td>
                <td className="num" data-label="ختامي دائن">{r.closing.credit ? fmt(r.closing.credit) : "—"}</td>
              </tr>
            ))}
            {displayRows.length === 0 && <tr><td className="empty" colSpan={8}>لا توجد حسابات لها أرصدة أو حركة ضمن هذا الفلتر.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td className="foot-label" colSpan={2}>الإجمالي</td>
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
