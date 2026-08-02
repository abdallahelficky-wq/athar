import React, { useEffect, useState } from "react";
import { getTrialBalance, getIncomeStatement, getBalanceSheet } from "../api/reports";
import { fmt } from "../legacy/constants";
import FinancialStatementPrintModal from "./FinancialStatementPrintModal";
import { Icon } from "../legacy/shared";
import Breadcrumb from "./shared/Breadcrumb";
import SubTabs from "./shared/SubTabs";

export const REPORT_TABS = [
  { id: "trial", label: "ميزان المراجعة" },
  { id: "income", label: "قائمة الدخل" },
  { id: "balance", label: "المركز المالي" },
];

const TYPE_LABEL = { asset: "أصول", liability: "التزامات", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات" };

function TrialBalanceView({ data }) {
  if (!data) return null;
  return (
    <div className="panel">
      <h3>ميزان المراجعة</h3>
      <table className="ledger-table responsive-table">
        <thead><tr><th>الحساب</th><th>التصنيف</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.accountId}>
              <td data-label="الحساب">{r.name}</td>
              <td className="type-tag" data-label="التصنيف">{TYPE_LABEL[r.type]}</td>
              <td className="num" data-label="مدين">{r.debit ? fmt(r.debit) : "—"}</td>
              <td className="num" data-label="دائن">{r.credit ? fmt(r.credit) : "—"}</td>
              <td className="num" data-label="الرصيد">{r.net >= 0 ? `${fmt(r.net)} مدين` : `${fmt(Math.abs(r.net))} دائن`}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="foot-label">الإجمالي</td><td></td>
            <td className="num strong">{fmt(data.totalDebit)}</td>
            <td className="num strong">{fmt(data.totalCredit)}</td>
            <td className={"num " + (data.balanced ? "balance-ok" : "balance-bad")}>
              {data.balanced ? "متوازن ✓" : "غير متوازن"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function IncomeStatementView({ data }) {
  if (!data) return null;
  return (
    <div className="panel">
      <h3>قائمة الدخل</h3>
      <table className="ledger-table">
        <tbody>
          <tr><td className="strong section-row" colSpan={2}>الإيرادات</td></tr>
          {data.revenueRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="strong">إجمالي الإيرادات</td><td className="num strong">{fmt(data.totalRevenue)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>المصروفات</td></tr>
          {data.expenseRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="strong">إجمالي المصروفات</td><td className="num strong">{fmt(data.totalExpense)}</td></tr>

          <tr className="net-row"><td className="strong">صافي الربح</td><td className="num strong">{fmt(data.netIncome)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function BalanceSheetView({ data }) {
  if (!data) return null;
  return (
    <div className="panel">
      <h3>المركز المالي</h3>
      <table className="ledger-table">
        <tbody>
          <tr><td className="strong section-row" colSpan={2}>الأصول</td></tr>
          {data.assetRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="strong">إجمالي الأصول</td><td className="num strong">{fmt(data.totalAssets)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>الالتزامات</td></tr>
          {data.liabilityRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
          ))}
          <tr><td className="strong">إجمالي الالتزامات</td><td className="num strong">{fmt(data.totalLiabilities)}</td></tr>

          <tr><td className="strong section-row" colSpan={2}>حقوق الملكية</td></tr>
          {data.equityRows.map((r) => (
            <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>
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
  const [trialBalance, setTrialBalance] = useState(null);
  const [incomeStatement, setIncomeStatement] = useState(null);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    Promise.all([
      getTrialBalance({ companyId }),
      getIncomeStatement({ companyId }),
      getBalanceSheet({ companyId }),
    ])
      .then(([tb, is, bs]) => {
        setTrialBalance(tb);
        setIncomeStatement(is);
        setBalanceSheet(bs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId]);

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
          {tab === "trial" && <TrialBalanceView data={trialBalance} />}
          {tab === "income" && <IncomeStatementView data={incomeStatement} />}
          {tab === "balance" && <BalanceSheetView data={balanceSheet} />}
        </>
      )}

      {printing && (
        <FinancialStatementPrintModal
          kind={tab}
          data={tab === "trial" ? trialBalance : tab === "income" ? incomeStatement : balanceSheet}
          company={companies?.find((c) => c.id === companyId)}
          autoPrint={false}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
