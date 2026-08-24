import React from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, downloadBlob } from "../legacy/shared";
import { fmt } from "../legacy/constants";
import { currencyLabel } from "../shared/countries";
import { getJournalEntryPdf } from "../api/journalEntries";

/** عرض/طباعة سند قيد محاسبي — يُستخدَم من شاشة القيود اليومية وصفحة عرض القيد المستقلة، يفيد من
 * هيدر/فوتر PrintShell المشترك تلقائياً. زر "تحميل PDF" يُنزّل ملفاً حقيقياً من الخادم (نفس آلية
 * توليد PDF المستخدَمة أصلاً لفواتير المبيعات) بدل فتح نافذة طباعة المتصفح. */
export default function JournalVoucherViewModal({ entry, companies, onClose }) {
  const { t, i18n } = useTranslation();
  const entryNumber = entry.entryNumber || entry.id.slice(-8);

  const handleDownload = async () => {
    try {
      const { blob, filename } = await getJournalEntryPdf(entry.id);
      downloadBlob(blob, filename || `${entryNumber}.pdf`);
    } catch (err) {
      window.alert(err.message);
    }
  };

  const company = companies?.find((c) => c.id === entry.companyId);
  const total = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const hasBranchedLines = entry.lines.some((l) => l.branch);

  // معادل سطر بعملة فرعه (لو مختلفة عن عملة الشركة وله سعر صرف يدوي مُدخَل) — للعرض فقط، بلا
  // أي تأثير على مبلغ السطر نفسه المُرحَّل بعملة الشركة الأم كما هو دائماً.
  const lineEquivalent = (l, amount) => {
    const branch = l.branch;
    const rate = branch?.exchangeRateToCompanyCurrency ? Number(branch.exchangeRateToCompanyCurrency) : null;
    if (!branch || !company || branch.currency === company.currency || !rate || !amount) return null;
    return (
      <div style={{ fontSize: "0.78em", opacity: 0.75 }}>
        ≈ {fmt(amount / rate)} {currencyLabel(branch.currency, i18n.language)}
      </div>
    );
  };

  return (
    <PrintShell
      subtitle={t("journalEntries.printModal.subtitle")}
      company={company}
      refNode={
        <>
          <div>{t("journalEntries.table.entryNumber")}: <strong>{entryNumber}</strong></div>
          <div>{t("journalEntries.table.date")}: <strong>{entry.date.slice(0, 10)}</strong></div>
        </>
      }
      onClose={onClose}
      onDownload={handleDownload}
    >
      <div className="voucher-meta">
        <div><span>{t("journalEntries.table.memo")}</span><strong>{entry.memo || t("journalEntries.table.noMemo")}</strong></div>
        <div><span>{t("journalEntries.table.status")}</span><strong>{entry.status === "posted" ? t("journalEntries.statusPosted") : t("journalEntries.statusSaved")}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead>
          <tr>
            <th>{t("journalEntries.form.lines.account")}</th><th>{t("journalEntries.form.lines.costCenter")}</th><th>{t("journalEntries.form.lines.department")}</th>
            {hasBranchedLines && <th>{t("journalEntries.form.lines.branch")}</th>}
            <th>{t("journalEntries.form.lines.description")}</th><th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.account?.name}</td>
              <td>{l.costCenter?.name || "—"}</td>
              <td>{l.departmentRef?.name || l.department || "—"}</td>
              {hasBranchedLines && <td>{l.branch?.nameAr || "—"}</td>}
              <td>{l.description || "—"}</td>
              <td className="num">{Number(l.debit) ? fmt(Number(l.debit)) : "—"}{lineEquivalent(l, Number(l.debit))}</td>
              <td className="num">{Number(l.credit) ? fmt(Number(l.credit)) : "—"}{lineEquivalent(l, Number(l.credit))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="foot-label" colSpan={hasBranchedLines ? 5 : 4}>{t("journalEntries.form.total")}</td>
            <td className="num strong">{fmt(total)}</td><td className="num strong">{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
