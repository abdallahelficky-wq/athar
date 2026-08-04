import React, { useEffect } from "react";
import { PrintShell, printWithOrientation } from "../legacy/shared";
import { fmt } from "../legacy/constants";

const TITLES = { trial: "ميزان المراجعة", income: "قائمة الدخل", balance: "المركز المالي" };

function TrialBalanceTable({ data }) {
  const rows = data.rows.filter(
    (r) => r.opening.debit || r.opening.credit || r.period.debit || r.period.credit || r.closing.debit || r.closing.credit,
  );
  return (
    <table className="ledger-table voucher-table">
      <thead>
        <tr>
          <th rowSpan={2}>الكود</th><th rowSpan={2}>الحساب</th>
          <th colSpan={2}>الرصيد الافتتاحي</th><th colSpan={2}>حركة الفترة</th><th colSpan={2}>الرصيد الختامي</th>
        </tr>
        <tr><th>مدين</th><th>دائن</th><th>مدين</th><th>دائن</th><th>مدين</th><th>دائن</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.accountId}>
            <td>{r.code}</td>
            <td>{r.name}</td>
            <td className="num">{r.opening.debit ? fmt(r.opening.debit) : "—"}</td>
            <td className="num">{r.opening.credit ? fmt(r.opening.credit) : "—"}</td>
            <td className="num">{r.period.debit ? fmt(r.period.debit) : "—"}</td>
            <td className="num">{r.period.credit ? fmt(r.period.credit) : "—"}</td>
            <td className="num">{r.closing.debit ? fmt(r.closing.debit) : "—"}</td>
            <td className="num">{r.closing.credit ? fmt(r.closing.credit) : "—"}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className="foot-label" colSpan={2}>الإجمالي</td>
          <td className="num strong">{fmt(data.totals.openingDebit)}</td>
          <td className="num strong">{fmt(data.totals.openingCredit)}</td>
          <td className="num strong">{fmt(data.totals.periodDebit)}</td>
          <td className="num strong">{fmt(data.totals.periodCredit)}</td>
          <td className="num strong">{fmt(data.totals.closingDebit)}</td>
          <td className="num strong">{fmt(data.totals.closingCredit)} {data.balanced ? "✓" : "⚠"}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function IncomeStatementTable({ data }) {
  return (
    <table className="ledger-table voucher-table">
      <tbody>
        <tr><td className="strong section-row" colSpan={2}>الإيرادات</td></tr>
        {data.revenueRows.map((r) => <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
        <tr><td className="strong">إجمالي الإيرادات</td><td className="num strong">{fmt(data.totalRevenue)}</td></tr>
        <tr><td className="strong section-row" colSpan={2}>المصروفات</td></tr>
        {data.expenseRows.map((r) => <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
        <tr><td className="strong">إجمالي المصروفات</td><td className="num strong">{fmt(data.totalExpense)}</td></tr>
        <tr className="net-row"><td className="strong">صافي الربح</td><td className="num strong">{fmt(data.netIncome)}</td></tr>
      </tbody>
    </table>
  );
}

function BalanceSheetTable({ data }) {
  return (
    <table className="ledger-table voucher-table">
      <tbody>
        <tr><td className="strong section-row" colSpan={2}>الأصول</td></tr>
        {data.assetRows.map((r) => <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
        <tr><td className="strong">إجمالي الأصول</td><td className="num strong">{fmt(data.totalAssets)}</td></tr>
        <tr><td className="strong section-row" colSpan={2}>الالتزامات</td></tr>
        {data.liabilityRows.map((r) => <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
        <tr><td className="strong">إجمالي الالتزامات</td><td className="num strong">{fmt(data.totalLiabilities)}</td></tr>
        <tr><td className="strong section-row" colSpan={2}>حقوق الملكية</td></tr>
        {data.equityRows.map((r) => <tr key={r.accountId}><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
        <tr><td className="indent">صافي الربح (أرباح مرحّلة)</td><td className="num">{fmt(data.netIncome)}</td></tr>
        <tr><td className="strong">إجمالي حقوق الملكية</td><td className="num strong">{fmt(data.totalEquity)}</td></tr>
        <tr className="net-row">
          <td className="strong">إجمالي الالتزامات وحقوق الملكية</td>
          <td className="num strong">{fmt(data.totalLiabilities + data.totalEquity)} {data.balanced ? "✓" : "⚠"}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** طباعة أي من التقارير المالية الثلاثة — نفس بيانات الشاشة بالضبط، داخل PrintShell المشترك */
export default function FinancialStatementPrintModal({ kind, data, company, asOfDate, autoPrint, onClose }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(t);
  }, [autoPrint, kind]);

  return (
    <PrintShell
      subtitle={TITLES[kind]}
      company={company}
      refNode={<div>حتى تاريخ: <strong>{asOfDate || new Date().toISOString().slice(0, 10)}</strong></div>}
      onClose={onClose}
    >
      {kind === "trial" && <TrialBalanceTable data={data} />}
      {kind === "income" && <IncomeStatementTable data={data} />}
      {kind === "balance" && <BalanceSheetTable data={data} />}
    </PrintShell>
  );
}
