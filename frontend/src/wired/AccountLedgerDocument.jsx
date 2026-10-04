import React from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { routes } from "../routes";
import { getAccountDisplayName } from "./shared/accountDisplayName";
import "../styles/account-ledger.css";

export default function AccountLedgerDocument({ ledger, company, periodLabel, printable = false }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const side = n => t(`statementOfAccount.table.${(n >= 0) === (ledger.normalSide !== "credit") ? "debit" : "credit"}`);
  const totals = ledger.rows.reduce((a,r) => ({debit:a.debit + Number(r.debit), credit:a.credit + Number(r.credit)}), {debit:0,credit:0});
  const cards = [["opening",t("statementOfAccount.openingBalance"),ledger.openingBalance], ["debit",t("accountLedger.design.debitTotal"),totals.debit], ["credit",t("accountLedger.design.creditTotal"),totals.credit], ["closing",`${t("statementOfAccount.closingBalance")} (${side(ledger.closingBalance)})`,Math.abs(ledger.closingBalance)]];
  return <article className="account-ledger-document" dir={i18n.dir()}>
    <header className="al-header"><div className="al-brand">{company?.logoUrl && <img src={company.logoUrl} alt={company.name} />}<div><h2>{company?.name || "أثر المحاسبي"}</h2><span>أثر المحاسبي</span></div></div><div><h2>{t("accountLedger.design.title")}</h2><span>Account Ledger</span></div></header>
    <section className="al-info">
      <div><span>{t("accountLedger.accountLabel")}</span><strong>{getAccountDisplayName(ledger.account,i18n.language)}</strong>{ledger.account.nameEn && <small>{ledger.account.nameEn}</small>}</div>
      <div><span>{t("accountLedger.design.code")}</span><strong>{ledger.account.code}</strong></div>
      <div><span>{t("accountLedger.design.period")}</span><strong>{periodLabel}</strong></div>
      <div><span>{t("accountLedger.design.vat")}</span><strong>{company?.vatNumber || "—"}</strong></div>
    </section>
    <section className="al-summary">{cards.map(([kind,label,value])=><div className={`al-card al-${kind}`} key={kind}><span>{label}</span><strong>{money(value)}</strong></div>)}</section>
    <div className="al-table-wrap"><table className="ledger-table al-table"><thead><tr>
      <th>{t("statementOfAccount.table.date")}</th><th>{t("accountLedger.table.entryNumber")}</th><th>{t("statementOfAccount.table.memo")}</th>
      {!ledger.account.isPosting && <th>{t("accountLedger.table.postingAccount")}</th>}
      <th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th><th>{t("statementOfAccount.table.balance")}</th>
    </tr></thead><tbody>
      <tr className="al-opening-row"><td colSpan={ledger.account.isPosting ? 5 : 6}>{t("statementOfAccount.openingBalance")}</td><td className="num">{money(ledger.openingBalance)}</td></tr>
      {ledger.rows.map((r,i)=><tr key={`${r.journalEntryId}-${i}`}><td>{r.date.slice(0,10)}</td><td>{printable ? r.entryNumber : <a href={routes.journalEntry(r.journalEntryId)} target="_blank" rel="noopener noreferrer">{r.entryNumber || r.journalEntryId.slice(-8)}</a>}</td><td className="al-memo"><strong>{r.entryMemo || "—"}</strong>{r.lineDescription && <small>{r.lineDescription}</small>}</td>{!ledger.account.isPosting && <td>{r.accountCode} — {r.accountName}</td>}<td className="num al-debit-text">{r.debit ? money(r.debit) : "—"}</td><td className="num al-credit-text">{r.credit ? money(r.credit) : "—"}</td><td className="num"><strong>{money(r.balance)}</strong></td></tr>)}
      {!ledger.rows.length && <tr><td colSpan={ledger.account.isPosting ? 6 : 7} className="empty">{t("statementOfAccount.empty")}</td></tr>}
    </tbody><tfoot><tr><td colSpan={ledger.account.isPosting ? 3 : 4}>{t("statementOfAccount.closingBalance")} ({side(ledger.closingBalance)})</td><td className="num">{money(totals.debit)}</td><td className="num">{money(totals.credit)}</td><td className="num">{money(ledger.closingBalance)}</td></tr></tfoot></table></div>
    <footer className="al-signatures"><div>{t("common.printShell.preparedBy")}<div className="al-sign-line"/><small>{user?.name || "—"}</small></div><div>{t("common.printShell.approvedBy")}<div className="al-sign-line"/></div><div>{t("common.printShell.stamp")}<div className="al-stamp"/></div></footer>
  </article>;
}
