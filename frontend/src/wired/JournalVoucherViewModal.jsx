import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, printWithOrientation } from "../legacy/shared";
import { fmt } from "../legacy/constants";

/** طباعة سند قيد محاسبي — يُستخدَم من شاشة القيود اليومية، يفيد من هيدر/فوتر PrintShell المشترك تلقائياً */
export default function JournalVoucherViewModal({ entry, companies, autoPrint, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, entry.id]);

  const company = companies?.find((c) => c.id === entry.companyId);
  const total = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);

  return (
    <PrintShell
      subtitle={t("journalEntries.printModal.subtitle")}
      company={company}
      refNode={
        <>
          <div>{t("journalEntries.table.entryNumber")}: <strong>{entry.entryNumber || entry.id.slice(-8)}</strong></div>
          <div>{t("journalEntries.table.date")}: <strong>{entry.date.slice(0, 10)}</strong></div>
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>{t("journalEntries.table.memo")}</span><strong>{entry.memo || t("journalEntries.table.noMemo")}</strong></div>
        <div><span>{t("journalEntries.table.status")}</span><strong>{entry.status === "posted" ? t("journalEntries.statusPosted") : t("journalEntries.statusSaved")}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr><th>{t("journalEntries.form.lines.account")}</th><th>{t("journalEntries.form.lines.costCenter")}</th><th>{t("journalEntries.form.lines.department")}</th><th>{t("journalEntries.form.lines.description")}</th><th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th></tr>
        </thead>
        <tbody>
          {entry.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.account?.name}</td>
              <td>{l.costCenter?.name || "—"}</td>
              <td>{l.departmentRef?.name || l.department || "—"}</td>
              <td>{l.description || "—"}</td>
              <td className="num">{Number(l.debit) ? fmt(Number(l.debit)) : "—"}</td>
              <td className="num">{Number(l.credit) ? fmt(Number(l.credit)) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className="foot-label" colSpan={4}>{t("journalEntries.form.total")}</td><td className="num strong">{fmt(total)}</td><td className="num strong">{fmt(total)}</td></tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
