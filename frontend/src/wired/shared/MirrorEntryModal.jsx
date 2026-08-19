import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { getMirrorSuggestion, createMirrorJournalEntry } from "../../api/journalEntries";
import { fmt2 } from "../../legacy/constants";
import AccountSearchSelect from "./AccountSearchSelect";

/**
 * "إنشاء قيد مرآة في شركة أخرى" — يُستخدَم من قيد مرحّل لتوليد القيد المقابل تلقائياً في شركة
 * شقيقة ضمن نفس المستأجر: يعكس السطر الممثّل للعلاقة بين الشركتين (مدين↔دائن) عبر حساب "ذمم بين
 * الشركات" (يُنشأ تلقائياً إن لم يوجد)، ويترك سطراً واحداً ليختاره المستخدم يدوياً من شجرة حسابات
 * الشركة الهدف لأنه يختلف بحسب طبيعة العملية. يُحفظ القيد الناتج دائماً بحالة "محفوظ" (غير مرحّل)
 * ليراجعه المستخدم قبل الترحيل، ويُربَط تبادلياً بالقيد الأصلي دون تغيير الشركة النشطة الحالية.
 */
export default function MirrorEntryModal({ entry, companies, accounts, onClose, onCreated }) {
  const { t } = useTranslation();
  const [step, setStep] = useState("choose");
  const [targetCompanyId, setTargetCompanyId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [suggestion, setSuggestion] = useState(null);
  const [memo, setMemo] = useState("");
  const [manualAccountId, setManualAccountId] = useState("");
  const [saving, setSaving] = useState(false);

  const otherCompanies = (companies || []).filter((c) => c.id !== entry.companyId);
  const targetCompany = otherCompanies.find((c) => c.id === targetCompanyId);

  const fetchSuggestion = async () => {
    if (!targetCompanyId) return;
    setLoading(true);
    setError("");
    try {
      const res = await getMirrorSuggestion(entry.id, targetCompanyId);
      setSuggestion(res);
      setMemo(res.memo || "");
      setManualAccountId("");
      setStep("review");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!suggestion || !manualAccountId) return;
    setSaving(true);
    setError("");
    try {
      const [autoLine, manualLine] = suggestion.lines;
      const result = await createMirrorJournalEntry(entry.id, {
        targetCompanyId,
        date: suggestion.date,
        memo,
        lines: [
          { accountId: autoLine.accountId, debit: autoLine.debit, credit: autoLine.credit },
          { accountId: manualAccountId, debit: manualLine.debit, credit: manualLine.credit },
        ],
      });
      onCreated(result, targetCompany);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const autoLine = suggestion?.lines?.[0];
  const manualLine = suggestion?.lines?.[1];

  return (
    <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && !loading && !saving && onClose()}>
      <div className="unpost-confirm-box from-document-box">
        <div className="modal-title-row">
          <h3>{t("journalModals.mirror.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={loading || saving} aria-label={t("common.close")}>×</button>
        </div>

        {step === "choose" && (
          <>
            <p className="note">{t("journalModals.mirror.chooseNote")}</p>
            <div className="form-grid">
              <label className="memo-field">
                {t("journalModals.mirror.targetCompanyLabel")}
                <select value={targetCompanyId} onChange={(e) => setTargetCompanyId(e.target.value)}>
                  <option value="">{t("journalModals.mirror.chooseOption")}</option>
                  {otherCompanies.map((c) => <option key={c.id} value={c.id}>{c.shortName || c.name}</option>)}
                </select>
              </label>
            </div>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={onClose} disabled={loading}>{t("common.cancel")}</button>
              <button className="btn-primary" onClick={fetchSuggestion} disabled={!targetCompanyId || loading}>
                {loading ? t("journalModals.mirror.preparing") : t("journalModals.mirror.continueBtn")}
              </button>
            </div>
          </>
        )}

        {step === "review" && suggestion && (
          <>
            <p className="note">
              {t("journalModals.mirror.reviewNote", { company: targetCompany?.shortName || targetCompany?.name })}
            </p>
            {!suggestion.detected && (
              <p className="balance-bad">{t("journalModals.mirror.noLinkWarning")}</p>
            )}
            <div className="form-grid">
              <label>{t("journalModals.mirror.dateLabel")}<input type="date" value={String(suggestion.date).slice(0, 10)} disabled /></label>
              <label className="memo-field">{t("journalModals.mirror.memoLabel")}<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
            </div>
            <div className="lines-table-wrap">
              <table className="lines-table">
                <thead><tr><th>{t("journalModals.mirror.table.account")}</th><th>{t("statementOfAccount.table.debit")}</th><th>{t("statementOfAccount.table.credit")}</th></tr></thead>
                <tbody>
                  <tr>
                    <td>{autoLine.accountName} <span className="note">{t("journalModals.mirror.autoTag")}</span></td>
                    <td className="num">{autoLine.debit ? fmt2(autoLine.debit) : "—"}</td>
                    <td className="num">{autoLine.credit ? fmt2(autoLine.credit) : "—"}</td>
                  </tr>
                  <tr>
                    <td>
                      <AccountSearchSelect accounts={accounts} value={manualAccountId} onChange={setManualAccountId} placeholder={t("journalModals.mirror.accountPlaceholder")} />
                    </td>
                    <td className="num">{manualLine.debit ? fmt2(manualLine.debit) : "—"}</td>
                    <td className="num">{manualLine.credit ? fmt2(manualLine.credit) : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={() => setStep("choose")} disabled={saving}>{t("journalModals.mirror.back")}</button>
              <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</button>
              <button className="btn-primary" onClick={submit} disabled={!manualAccountId || saving}>
                {saving ? t("journalModals.mirror.saving") : t("journalModals.mirror.saveBtn")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
