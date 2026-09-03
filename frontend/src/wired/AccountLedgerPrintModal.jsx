import React from "react";
import { useTranslation } from "react-i18next";
import { PrintShell } from "../legacy/shared";
import { fmt } from "../legacy/constants";

/** نسخة قابلة للطباعة من كشف حساب الأستاذ لأي حساب — نفس أسلوب StatementOfAccountModal، داخل PrintShell المشترك */
export default function AccountLedgerPrintModal({ ledger, companyId, companies, onClose }) {
  const { t } = useTranslation();
  const company = companies?.find((c) => c.id === companyId);

  return (
    <PrintShell
      subtitle={t("nav.tabs.ledger")}
      company={company}
      refNode={<div>{t("accountLedger.accountLabel")}: <strong>{ledger.account.name}</strong></div>}
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>{t("statementOfAccount.closingBalance")}</span><strong>{fmt(Math.abs(ledger.closingBalance))} {ledger.closingBalance >= 0 ? t("statementOfAccount.table.debit") : t("statementOfAccount.table.credit")}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr>
            <th>{t("statementOfAccount.table.date")}</th><th>{t("accountLedger.table.entryNumber")}</th><th>{t("statementOfAccount.table.memo")}</th><th>{t("accountLedger.table.description")}</th>
            {!ledger.account.isPosting && <th>{t("accountLedger.table.postingAccount")}</th>}
            <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th><th>{t("statementOfAccount.table.balance")}</th>
          </tr>
        </thead>
        <tbody>
          {Boolean(ledger.openingBalance) && (
            <tr>
              <td colSpan={ledger.account.isPosting ? 6 : 7} className="foot-label">{t("statementOfAccount.openingBalance")}</td>
              <td className="num strong">{fmt(ledger.openingBalance)}</td>
            </tr>
          )}
          {ledger.rows.map((r, i) => (
            <tr key={r.journalEntryId + i}>
              <td>{r.date.slice(0, 10)}</td>
              <td>{r.journalEntryId.slice(-8)}</td>
              <td>{r.entryMemo || "—"}</td>
              <td>{r.lineDescription || "—"}</td>
              {!ledger.account.isPosting && <td>{r.accountCode} — {r.accountName}</td>}
              <td className="num">{r.debit ? fmt(r.debit) : "—"}</td>
              <td className="num">{r.credit ? fmt(r.credit) : "—"}</td>
              <td className="num strong">{fmt(r.balance)}</td>
            </tr>
          ))}
          {ledger.rows.length === 0 && <tr><td className="empty" colSpan={ledger.account.isPosting ? 7 : 8}>{t("statementOfAccount.empty")}</td></tr>}
        </tbody>
        <tfoot>
          <tr><td className="foot-label" colSpan={ledger.account.isPosting ? 6 : 7}>{t("statementOfAccount.closingBalance")}</td><td className="num strong">{fmt(ledger.closingBalance)}</td></tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
