import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCustomerStatement, getSupplierStatement } from "../api/reports";
import { PrintShell } from "../legacy/shared";
import { fmt } from "../legacy/constants";

/**
 * كشف حساب عميل أو مورد — يجلب البيانات من نقطة النهاية الجديدة (سجل حركة + رصيد متحرك
 * على حساب الذمم فقط) ويعرضها داخل PrintShell المشترك، فتظهر جاهزة للطباعة مباشرة (زرّا
 * "طباعة"/"تحميل PDF" من PrintShell نفسه) بنفس هيدر/فوتر أي مطبوعة أخرى في النظام.
 */
export default function StatementOfAccountModal({ kind, party, companyId, companies, onClose }) {
  const { t } = useTranslation();
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetcher = kind === "customer" ? getCustomerStatement : getSupplierStatement;
    fetcher(party.id, { companyId }).then(setStatement).catch((e) => setError(e.message));
  }, [kind, party.id, companyId]);

  const company = companies?.find((c) => c.id === companyId);
  const partyLabel = kind === "customer" ? t("statementOfAccount.customer") : t("statementOfAccount.supplier");

  if (error) {
    return (
      <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="unpost-confirm-box">
          <div className="modal-title-row">
            <h3>{t("statementOfAccount.titleFailed")}</h3>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t("statementOfAccount.close")}>×</button>
          </div>
          <p className="balance-bad">{error}</p>
          <div className="form-btn-group"><button className="btn-ghost" onClick={onClose}>{t("statementOfAccount.close")}</button></div>
        </div>
      </div>
    );
  }
  if (!statement) return null;

  return (
    <PrintShell
      subtitle={t("statementOfAccount.subtitle", { party: partyLabel })}
      company={company}
      refNode={<div>{partyLabel}: <strong>{party.name}</strong></div>}
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>{t("statementOfAccount.vatNumber")}</span><strong>{party.vatNumber || "—"}</strong></div>
        <div>
          <span>{t("statementOfAccount.closingBalance")}</span>
          <strong>
            {fmt(Math.abs(statement.closingBalance))}{" "}
            {kind === "customer"
              ? (statement.closingBalance >= 0 ? t("statementOfAccount.customerDebit") : t("statementOfAccount.customerCredit"))
              : (statement.closingBalance >= 0 ? t("statementOfAccount.supplierCredit") : t("statementOfAccount.supplierDebit"))}
          </strong>
        </div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr>
            <th>{t("statementOfAccount.table.date")}</th><th>{t("statementOfAccount.table.memo")}</th>
            <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th>
            <th>{t("statementOfAccount.table.balance")}</th>
          </tr>
        </thead>
        <tbody>
          {Boolean(statement.openingBalance) && (
            <tr>
              <td className="foot-label" colSpan={2}>{t("statementOfAccount.openingBalance")}</td>
              <td className="num" colSpan={2}></td>
              <td className="num strong">{fmt(statement.openingBalance)}</td>
            </tr>
          )}
          {statement.rows.map((r, i) => (
            <tr key={r.journalEntryId + i}>
              <td>{r.date.slice(0, 10)}</td>
              <td>{r.memo || t("statementOfAccount.noMemo")}</td>
              <td className="num">{r.debit ? fmt(r.debit) : "—"}</td>
              <td className="num">{r.credit ? fmt(r.credit) : "—"}</td>
              <td className="num strong">{fmt(r.balance)}</td>
            </tr>
          ))}
          {statement.rows.length === 0 && <tr><td className="empty" colSpan={5}>{t("statementOfAccount.empty")}</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td className="foot-label" colSpan={4}>{t("statementOfAccount.closingBalance")}</td>
            <td className="num strong">{fmt(statement.closingBalance)}</td>
          </tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
