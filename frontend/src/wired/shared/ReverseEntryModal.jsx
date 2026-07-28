import React, { useState } from "react";
import { reverseJournalEntry } from "../../api/journalEntries";
import { fmt2 } from "../../legacy/constants";

/**
 * "عكس القيد" — لا تُعدِّل أو تُرحِّل/تفك ترحيل القيد الأصلي إطلاقاً؛ تعرض معاينة القيد الجديد
 * (نفس الحساب/مركز التكلفة/القسم/الوصف الخاص بكل سطر، لكن بعكس المدين/الدائن) وتاريخاً افتراضياً
 * هو تاريخ اليوم قابلاً للتعديل، ثم تُنشئ القيد العكسي كمسودة عبر الخادم عند التأكيد.
 */
export default function ReverseEntryModal({ entry, onClose, onCreated }) {
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
    <div className="unpost-confirm-overlay">
      <div className="unpost-confirm-box from-document-box">
        <h3>عكس القيد</h3>
        <p className="note">
          سيُنشأ قيد جديد منفصل بنفس بنود القيد الأصلي (البيان: <strong>{entry.memo || "بدون بيان"}</strong>) مع عكس
          المدين والدائن على كل سطر، ويُحفَظ كمسودة لتراجعه قبل الترحيل. القيد الأصلي لن يتغيّر إطلاقاً.
        </p>
        <div className="form-grid">
          <label>تاريخ القيد العكسي<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>الحساب</th><th>القسم</th><th>الوصف</th><th>مدين</th><th>دائن</th></tr></thead>
            <tbody>
              {reversedLines.map((l) => (
                <tr key={l.id}>
                  <td>{l.account?.name}</td>
                  <td>{l.department || "—"}</td>
                  <td>{l.description || "—"}</td>
                  <td className="num">{l.debit ? fmt2(l.debit) : "—"}</td>
                  <td className="num">{l.credit ? fmt2(l.credit) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td className="foot-label" colSpan={3}>الإجمالي</td><td className="num strong">{fmt2(total)}</td><td className="num strong">{fmt2(total)}</td></tr>
            </tfoot>
          </table>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "جارٍ الحفظ..." : "إنشاء القيد العكسي كمسودة"}
          </button>
        </div>
      </div>
    </div>
  );
}
