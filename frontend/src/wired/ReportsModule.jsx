import React, { useEffect, useState } from "react";
import { getTrialBalance, getIncomeStatement, getBalanceSheet } from "../api/reports";
import { listAccounts } from "../api/accounts";
import { fmt } from "../legacy/constants";
import FinancialStatementPrintModal from "./FinancialStatementPrintModal";
import { Icon } from "../legacy/shared";
import Breadcrumb from "./shared/Breadcrumb";
import SubTabs from "./shared/SubTabs";
import ReportRollupFilter from "./shared/ReportRollupFilter";
import TrialBalanceView from "./TrialBalanceView";

export const REPORT_TABS = [
  { id: "trial", label: "ميزان المراجعة" },
  { id: "income", label: "قائمة الدخل" },
  { id: "balance", label: "المركز المالي" },
];

function IncomeStatementView({ data, accounts, level, setLevel, accountId, setAccountId, includeDetails, setIncludeDetails, search, setSearch, dateFrom, setDateFrom, dateTo, setDateTo }) {
  if (!data) return null;
  return (
    <div className="panel">
      <h3>قائمة الدخل</h3>
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
      <table className="ledger-table">
        <tbody>
          <tr><td className="strong section-row" colSpan={2}>الإيرادات</td></tr>
          {data.revenueRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.code} — {r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="strong">إجمالي الإيرادات</td><td className="num strong">{fmt(data.totalRevenue)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>المصروفات</td></tr>
          {data.expenseRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.code} — {r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="strong">إجمالي المصروفات</td><td className="num strong">{fmt(data.totalExpense)}</td></tr>

          <tr className="net-row"><td className="strong">صافي الربح</td><td className="num strong">{fmt(data.netIncome)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function BalanceSheetView({ data, accounts, level, setLevel, accountId, setAccountId, includeDetails, setIncludeDetails, search, setSearch, asOfDate, setAsOfDate }) {
  if (!data) return null;
  return (
    <div className="panel">
      <h3>المركز المالي</h3>
      <div className="filter-bar">
        <label>حتى تاريخ<input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} /></label>
      </div>
      <ReportRollupFilter
        accounts={accounts}
        level={level} onLevelChange={setLevel}
        accountId={accountId} onAccountChange={setAccountId}
        includeDetails={includeDetails} onIncludeDetailsChange={setIncludeDetails}
        search={search} onSearchChange={setSearch}
      />
      <table className="ledger-table">
        <tbody>
          <tr><td className="strong section-row" colSpan={2}>الأصول</td></tr>
          {data.assetRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.code} — {r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="strong">إجمالي الأصول</td><td className="num strong">{fmt(data.totalAssets)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>الالتزامات</td></tr>
          {data.liabilityRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.code} — {r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="strong">إجمالي الالتزامات</td><td className="num strong">{fmt(data.totalLiabilities)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>حقوق الملكية</td></tr>
          {data.equityRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.code} — {r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="indent">صافي الربح (أرباح مرحّلة)</td><td className="num">{fmt(data.netIncome)}</td></tr>
          <tr><td className="strong">إجمالي حقوق الملكية</td><td className="num strong">{fmt(data.totalEquity)}</td></tr>

          <tr className="net-row">
            <td className="strong">إجمالي الالتزامات وحقوق الملكية</td>
            <td className={"num strong " + (data.balanced ? "balance-ok" : "balance-bad")}>
              {fmt(data.totalLiabilities + data.totalEquity)} {data.balanced ? "✓" : "⚠"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsModule({ companies, companyId, tab, setTab }) {
  const [accounts, setAccounts] = useState([]);
  const [trialBalance, setTrialBalance] = useState(null);
  const [incomeStatement, setIncomeStatement] = useState(null);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));

  // فلتر التجميع (مستوى/فرع معيّن/تفاصيل/بحث) مشترك بين التقارير الثلاثة — نفس منطق التقارير
  // الموحّد المطلوب تطبيقه على أي تقرير مالي حالي أو مستقبلي في النظام.
  const [level, setLevel] = useState(4);
  const [accountId, setAccountId] = useState("");
  const [includeDetails, setIncludeDetails] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listAccounts({ tree: true, companyId }).then(setAccounts).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const rollup = { level, accountId: accountId || undefined, includeDetails: includeDetails || undefined, search: search || undefined };
    Promise.all([
      getTrialBalance({ companyId, from: dateFrom || undefined, to: dateTo || undefined, ...rollup }),
      getIncomeStatement({ companyId, from: dateFrom || undefined, to: dateTo || undefined, ...rollup }),
      getBalanceSheet({ companyId, date: asOfDate || undefined, ...rollup }),
    ])
      .then(([tb, is, bs]) => {
        setTrialBalance(tb);
        setIncomeStatement(is);
        setBalanceSheet(bs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId, dateFrom, dateTo, asOfDate, level, accountId, includeDetails, search]);

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["الإفصاح المالي", "بيانات حقيقية"]} />
        <h2>التقارير المالية الرئيسية</h2>
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {!companyId ? (
        <p className="empty">أنشئ شركة أولاً من لوحة القيادة لعرض تقاريرها المالية.</p>
      ) : loading ? (
        <p className="empty">جارٍ التحميل...</p>
      ) : (
        <>
          <SubTabs
            tabs={REPORT_TABS}
            active={tab}
            onChange={setTab}
            trailing={<button className="icon-btn" title="طباعة التقرير الحالي" onClick={() => setPrinting(true)}><Icon.Printer /></button>}
          />
          {tab === "trial" && (
            <TrialBalanceView
              accounts={accounts}
              data={trialBalance}
              dateFrom={dateFrom} setDateFrom={setDateFrom}
              dateTo={dateTo} setDateTo={setDateTo}
              level={level} setLevel={setLevel}
              accountId={accountId} setAccountId={setAccountId}
              includeDetails={includeDetails} setIncludeDetails={setIncludeDetails}
              search={search} setSearch={setSearch}
            />
          )}
          {tab === "income" && (
            <IncomeStatementView
              data={incomeStatement}
              accounts={accounts}
              level={level} setLevel={setLevel}
              accountId={accountId} setAccountId={setAccountId}
              includeDetails={includeDetails} setIncludeDetails={setIncludeDetails}
              search={search} setSearch={setSearch}
              dateFrom={dateFrom} setDateFrom={setDateFrom}
              dateTo={dateTo} setDateTo={setDateTo}
            />
          )}
          {tab === "balance" && (
            <BalanceSheetView
              data={balanceSheet}
              accounts={accounts}
              level={level} setLevel={setLevel}
              accountId={accountId} setAccountId={setAccountId}
              includeDetails={includeDetails} setIncludeDetails={setIncludeDetails}
              search={search} setSearch={setSearch}
              asOfDate={asOfDate} setAsOfDate={setAsOfDate}
            />
          )}
        </>
      )}

      {printing && (
        <FinancialStatementPrintModal
          kind={tab}
          data={tab === "trial" ? trialBalance : tab === "income" ? incomeStatement : balanceSheet}
          company={companies?.find((c) => c.id === companyId)}
          asOfDate={tab === "balance" ? asOfDate : dateTo}
          autoPrint={false}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
