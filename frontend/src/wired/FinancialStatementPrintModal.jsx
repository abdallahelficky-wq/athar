import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, printWithOrientation } from "../legacy/shared";
import { fmt } from "../legacy/constants";

function TrialBalanceTable({ data, t }) {
  const rows = data.rows.filter(
    (r) => r.opening.debit || r.opening.credit || r.period.debit || r.period.credit || r.closing.debit || r.closing.credit,
  );
  return (
    <table className="ledger-table voucher-table">
      <thead>
        <tr>
          <th rowSpan={2}>{t("reports.statementPrint.codeHeader")}</th><th rowSpan={2}>{t("reports.trial.table.account")}</th>
          <th colSpan={2}>{t("reports.trial.table.openingBalance")}</th><th colSpan={2}>{t("reports.trial.table.periodMovement")}</th><th colSpan={2}>{t("reports.trial.table.closingBalance")}</th>
        </tr>
        <tr>
          <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th>
          <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th>
          <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th>
        </tr>
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
          <td className="foot-label" colSpan={2}>{t("reports.statementPrint.totalLabel")}</td>
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

/** صفوف شجرة مبلغ واحد للطباعة — نفس شجرة الشاشة (AmountTreeRows في ReportsModule)، موسّعة بالكامل دائماً. */
function PrintAmountTreeRows({ nodes, depth = 0 }) {
  return nodes.map((node) => (
    <React.Fragment key={node.accountId}>
      <tr className={!node.isPosting ? "strong" : undefined}>
        <td className="indent" style={{ paddingRight: 8 + depth * 22 }}>{node.code} — {node.name}</td>
        <td className="num">{fmt(node.amount)}</td>
      </tr>
      {node.children.length > 0 && <PrintAmountTreeRows nodes={node.children} depth={depth + 1} />}
    </React.Fragment>
  ));
}

function IncomeStatementTable({ data, t }) {
  return (
    <table className="ledger-table voucher-table">
      <tbody>
        <tr><td className="strong section-row" colSpan={2}>{t("reports.income.revenue")}</td></tr>
        <PrintAmountTreeRows nodes={data.revenueRoots} />
        <tr><td className="strong">{t("reports.income.totalRevenue")}</td><td className="num strong">{fmt(data.totalRevenue)}</td></tr>
        <tr><td className="strong section-row" colSpan={2}>{t("reports.income.expenses")}</td></tr>
        <PrintAmountTreeRows nodes={data.expenseRoots} />
        <tr><td className="strong">{t("reports.income.totalExpenses")}</td><td className="num strong">{fmt(data.totalExpense)}</td></tr>
        <tr className="net-row"><td className="strong">{t("reports.income.netIncome")}</td><td className="num strong">{fmt(data.netIncome)}</td></tr>
      </tbody>
    </table>
  );
}

function BalanceSheetTable({ data, t }) {
  return (
    <table className="ledger-table voucher-table">
      <tbody>
        <tr><td className="strong section-row" colSpan={2}>{t("reports.balance.assets")}</td></tr>
        <PrintAmountTreeRows nodes={data.assetRoots} />
        <tr><td className="strong">{t("reports.balance.totalAssets")}</td><td className="num strong">{fmt(data.totalAssets)}</td></tr>
        <tr><td className="strong section-row" colSpan={2}>{t("reports.balance.liabilities")}</td></tr>
        <PrintAmountTreeRows nodes={data.liabilityRoots} />
        <tr><td className="strong">{t("reports.balance.totalLiabilities")}</td><td className="num strong">{fmt(data.totalLiabilities)}</td></tr>
        <tr><td className="strong section-row" colSpan={2}>{t("reports.balance.equity")}</td></tr>
        <PrintAmountTreeRows nodes={data.equityRoots} />
        <tr><td className="indent">{t("reports.balance.retainedEarnings")}</td><td className="num">{fmt(data.netIncome)}</td></tr>
        <tr><td className="strong">{t("reports.balance.totalEquity")}</td><td className="num strong">{fmt(data.totalEquity)}</td></tr>
        <tr className="net-row">
          <td className="strong">{t("reports.balance.totalLiabEquity")}</td>
          <td className="num strong">{fmt(data.totalLiabilities + data.totalEquity)} {data.balanced ? "✓" : "⚠"}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** طباعة أي من التقارير المالية الثلاثة — نفس بيانات الشاشة بالضبط، داخل PrintShell المشترك */
export default function FinancialStatementPrintModal({ kind, data, company, asOfDate, autoPrint, onClose }) {
  const { t } = useTranslation();
  const TITLES = { trial: t("nav.tabs.trial"), income: t("nav.tabs.income"), balance: t("nav.tabs.balance") };

  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, kind]);

  return (
    <PrintShell
      subtitle={TITLES[kind]}
      company={company}
      refNode={<div>{t("reports.statementPrint.asOfDateLabel")} <strong>{asOfDate || new Date().toISOString().slice(0, 10)}</strong></div>}
      onClose={onClose}
    >
      {kind === "trial" && <TrialBalanceTable data={data} t={t} />}
      {kind === "income" && <IncomeStatementTable data={data} t={t} />}
      {kind === "balance" && <BalanceSheetTable data={data} t={t} />}
    </PrintShell>
  );
}
