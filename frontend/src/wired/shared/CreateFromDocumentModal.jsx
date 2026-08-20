import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createJournalEntryFromDocument, updateJournalEntry, postJournalEntry } from "../../api/journalEntries";
import { fmt2 } from "../../legacy/constants";
import AccountSearchSelect from "./AccountSearchSelect";
import { currencyLabel } from "../../shared/countries";

/**
 * "إنشاء قيد من مستند" — يرفع صورة/PDF، يستدعي الذكاء الاصطناعي عبر الخادم لاقتراح قيد
 * كامل (بحالة "محفوظ")، ثم يعرضه قابلاً للتعديل الكامل بجانب صورة المستند نفسه للمقارنة، بزرّين
 * منفصلين: "حفظ" (يبقى بحالة محفوظ قابلاً للتعديل لاحقاً) و"موافقة وترحيل" (يرحّله فوراً
 * بعد حفظ أي تعديلات، فيُقفَل تماماً). القيد لا يُرحَّل تلقائياً أبداً دون ضغط هذا الزر صراحة.
 */
export default function CreateFromDocumentModal({ companyId, companies, accounts, onClose, onCreated }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const [result, setResult] = useState(null); // { entry, attachment, aiConfidenceNote }
  const [date, setDate] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = lines.length >= 2 && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setError("");
  };

  const analyze = async () => {
    if (!file || !companyId) return;
    setAnalyzing(true);
    setError("");
    try {
      const res = await createJournalEntryFromDocument(companyId, file);
      setResult(res);
      setDate(res.entry.date.slice(0, 10));
      setMemo(res.entry.memo || "");
      setLines(res.entry.lines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.debit) || "",
        credit: Number(l.credit) || "",
      })));
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, { accountId: "", debit: "", credit: "" }]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const buildPayload = () => ({
    companyId,
    date,
    memo,
    lines: lines
      .filter((l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)
      .map((l) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })),
  });

  const saveDraft = async () => {
    if (!result || !balanced) return;
    setSaving(true);
    setError("");
    try {
      await updateJournalEntry(result.entry.id, buildPayload());
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const approveAndPost = async () => {
    if (!result || !balanced) return;
    setSaving(true);
    setError("");
    try {
      await updateJournalEntry(result.entry.id, buildPayload());
      await postJournalEntry(result.entry.id);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isPdf = useMemo(() => file?.type === "application/pdf", [file]);

  return (
    <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && !analyzing && !saving && onClose()}>
      <div className="unpost-confirm-box from-document-box">
        <div className="modal-title-row">
          <h3>{t("journalModals.fromDocument.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={analyzing || saving} aria-label={t("common.close")}>×</button>
        </div>

        {!result && (
          <>
            <p className="note">{t("journalModals.fromDocument.uploadNote")}</p>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={onPickFile} />
            {previewUrl && !isPdf && <img src={previewUrl} alt={t("journalModals.fromDocument.previewAlt")} className="from-document-preview" />}
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={onClose} disabled={analyzing}>{t("common.cancel")}</button>
              <button className="btn-primary" onClick={analyze} disabled={!file || analyzing}>
                {analyzing ? t("journalModals.fromDocument.analyzing") : t("journalModals.fromDocument.analyzeBtn")}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="from-document-review">
            <div className="from-document-side">
              <h4>{t("journalModals.fromDocument.documentTitle")}</h4>
              {isPdf
                ? <a href={previewUrl} target="_blank" rel="noreferrer" className="btn-ghost">{t("journalModals.fromDocument.openPdf")}</a>
                : <img src={previewUrl} alt={t("journalModals.fromDocument.documentAlt")} className="from-document-preview" />}
              {result.aiConfidenceNote && <p className="note">{t("journalModals.fromDocument.aiNote", { note: result.aiConfidenceNote })}</p>}
            </div>

            <div className="from-document-side">
              <h4>{t("journalModals.fromDocument.proposedTitle")}</h4>
              <div className="form-grid">
                <label>{t("journalModals.fromDocument.dateLabel")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                <label className="memo-field">{t("journalModals.fromDocument.memoLabel")}<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
              </div>
              <div className="lines-table-wrap">
                <table className="lines-table">
                  <thead><tr><th>{t("journalModals.fromDocument.table.account")}</th><th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th><th></th></tr></thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={idx}>
                        <td>
                          <AccountSearchSelect accounts={accounts} value={l.accountId} onChange={(accountId) => updateLine(idx, "accountId", accountId)} />
                        </td>
                        <td><input type="number" className="amount-input" value={l.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)} /></td>
                        <td><input type="number" className="amount-input" value={l.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)} /></td>
                        <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn-ghost" onClick={addLine}>{t("journalModals.fromDocument.addLine")}</button>
              <div className="balance-status">
                {balanced
                  ? <span className="balance-ok">{t("journalModals.fromDocument.balancedOk")}</span>
                  : <span className="balance-bad">{t("journalModals.fromDocument.balanceDiff", { amount: fmt2(Math.abs(totalDebit - totalCredit)), currency })}</span>}
              </div>

              {error && <p className="balance-bad">{error}</p>}
              <div className="form-btn-group">
                <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("common.close")}</button>
                <button className="btn-ghost" onClick={saveDraft} disabled={!balanced || saving}>
                  {saving ? t("journalModals.fromDocument.saving") : t("journalModals.fromDocument.saveDraft")}
                </button>
                <button className="btn-primary" onClick={approveAndPost} disabled={!balanced || saving}>
                  {saving ? t("journalModals.fromDocument.saving") : t("journalModals.fromDocument.approveAndPost")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
