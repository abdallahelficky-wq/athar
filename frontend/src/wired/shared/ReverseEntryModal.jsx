import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { reverseJournalEntry } from "../../api/journalEntries";
import { fmt2 } from "../../legacy/constants";

/**
 * "عكس القيد" — لا تُعدِّل أو تُرحِّل/تفك ترحيل القيد الأصلي إطلاقاً؛ تعرض معاينة القيد الجديد
 * (نفس الحساب/مركز التكلفة/القسم/الوصف الخاص بكل سطر، لكن بعكس المدين/الدائن) وتاريخاً افتراضياً
 * هو تاريخ اليوم قابلاً للتعديل، ثم تُنشئ القيد العكسي بحالة "محفوظ" (غير مرحّل) عبر الخادم عند
 * التأكيد، ليراجعه المستخدم قبل الترحيل.
 */
export default function ReverseEntryModal({ entry, onClose, onCreated }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reversedLines = entry.lines.map((l) => ({ ...l, debit: Number(l.credit), credit: Number(l.debit) }));
  const total = reversedLines.reduce((s, l) => s + Number(l.debit || 0), 0);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const reversal = await reverseJournalEntry(entry.id, date);
      onCreated(reversal);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="unpost-confirm-box from-document-box">
        <div className="modal-title-row">
          <h3>{t("journalModals.reverse.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("common.close")}>×</button>
        </div>
        <p className="note">
          {t("journalModals.reverse.note", { memo: entry.memo || t("journalEntries.table.noMemo") })}
        </p>
        <div className="form-grid">
          <label>{t("journalModals.reverse.dateLabel")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>{t("journalModals.reverse.table.account")}</th><th>{t("journalEntries.form.lines.department")}</th><th>{t("journalEntries.form.lines.description")}</th><th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th></tr></thead>
            <tbody>
              {reversedLines.map((l) => (
                <tr key={l.id}>
                  <td>{l.account?.name}</td>
                  <td>{l.departmentRef?.name || l.department || "—"}</td>
                  <td>{l.description || "—"}</td>
                  <td className="num">{l.debit ? fmt2(l.debit) : "—"}</td>
                  <td className="num">{l.credit ? fmt2(l.credit) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td className="foot-label" colSpan={3}>{t("journalEntries.form.total")}</td><td className="num strong">{fmt2(total)}</td><td className="num strong">{fmt2(total)}</td></tr>
            </tfoot>
          </table>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? t("journalModals.reverse.saving") : t("journalModals.reverse.createBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
