import React, { useState } from "react";
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
          <h3>إنشاء قيد مرآة في شركة أخرى</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={loading || saving} aria-label="إغلاق">×</button>
        </div>

        {step === "choose" && (
          <>
            <p className="note">
              اختر الشركة الشقيقة التي وقعت معها هذه العملية، وسيُقترَح لك قيد مقابل جاهز فيها (بحالة
              محفوظ، قابل للمراجعة قبل الترحيل)، مع عكس اتجاه المدين/الدائن على حساب الربط بين الشركتين.
            </p>
            <div className="form-grid">
              <label className="memo-field">
                الشركة المستهدفة
                <select value={targetCompanyId} onChange={(e) => setTargetCompanyId(e.target.value)}>
                  <option value="">— اختر —</option>
                  {otherCompanies.map((c) => <option key={c.id} value={c.id}>{c.shortName || c.name}</option>)}
                </select>
              </label>
            </div>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={onClose} disabled={loading}>إلغاء</button>
              <button className="btn-primary" onClick={fetchSuggestion} disabled={!targetCompanyId || loading}>
                {loading ? "جارٍ التحضير..." : "متابعة"}
              </button>
            </div>
          </>
        )}

        {step === "review" && suggestion && (
          <>
            <p className="note">
              سيُحفَظ هذا القيد بحالة "محفوظ" في شركة <strong>{targetCompany?.shortName || targetCompany?.name}</strong>،
              وسيبقى مرتبطاً بالقيد الأصلي. راجع الحساب المختار للسطر الثاني ثم احفظ.
            </p>
            {!suggestion.detected && (
              <p className="balance-bad">
                لم يُعثر على حساب ربط محدَّد مسبقاً بين الشركتين على هذا القيد تحديداً، فتم استخدام إجمالي
                القيد وإنشاء حسابات الربط تلقائياً — راجع المبالغ جيداً قبل الترحيل.
              </p>
            )}
            <div className="form-grid">
              <label>التاريخ<input type="date" value={String(suggestion.date).slice(0, 10)} disabled /></label>
              <label className="memo-field">البيان<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
            </div>
            <div className="lines-table-wrap">
              <table className="lines-table">
                <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
                <tbody>
                  <tr>
                    <td>{autoLine.accountName} <span className="note">(تلقائي)</span></td>
                    <td className="num">{autoLine.debit ? fmt2(autoLine.debit) : "—"}</td>
                    <td className="num">{autoLine.credit ? fmt2(autoLine.credit) : "—"}</td>
                  </tr>
                  <tr>
                    <td>
                      <AccountSearchSelect accounts={accounts} value={manualAccountId} onChange={setManualAccountId} placeholder="اختر الحساب..." />
                    </td>
                    <td className="num">{manualLine.debit ? fmt2(manualLine.debit) : "—"}</td>
                    <td className="num">{manualLine.credit ? fmt2(manualLine.credit) : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={() => setStep("choose")} disabled={saving}>رجوع</button>
              <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
              <button className="btn-primary" onClick={submit} disabled={!manualAccountId || saving}>
                {saving ? "جارٍ الحفظ..." : "حفظ القيد المقابل"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
