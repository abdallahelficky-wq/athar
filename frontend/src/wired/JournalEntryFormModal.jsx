import React, { useMemo, useState } from "react";
import { createJournalEntry, updateJournalEntry } from "../api/journalEntries";
import { fmt2 } from "../legacy/constants";

const emptyLine = () => ({ accountId: "", costCenterId: "", department: "", description: "", debit: "", credit: "" });

const lineFromExisting = (l) => ({
  accountId: l.accountId,
  costCenterId: l.costCenterId || "",
  department: l.department || "",
  description: l.description || "",
  debit: Number(l.debit) || "",
  credit: Number(l.credit) || "",
});

/**
 * نافذة (Modal) إنشاء/تعديل قيد يومية — نفس منطق InvoiceFormModal (فواتير المبيعات): شاشة
 * القيود أصبحت قائمة فقط، وهذه النافذة تحمل فورم الإدخال الفعلي بالكامل (بما في ذلك حقل "الوصف"
 * الجديد على مستوى كل سطر، منفصل عن بيان القيد العام).
 */
export default function JournalEntryFormModal({ companyId, accounts, costCenters, editingEntry, onClose, onSaved }) {
  const isEdit = !!editingEntry;

  const [date, setDate] = useState(() => (isEdit ? editingEntry.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [memo, setMemo] = useState(editingEntry?.memo || "");
  const [lines, setLines] = useState(() => (isEdit ? editingEntry.lines.map(lineFromExisting) : [emptyLine(), emptyLine()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const costCenterOptions = useMemo(
    () => costCenters.filter((c) => !c.companyId || c.companyId === companyId),
    [costCenters, companyId],
  );

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const diff = totalDebit - totalCredit;
  const canPost = lines.filter((l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0).length >= 2
    && totalDebit > 0 && Math.abs(diff) < 0.01;

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const submit = async () => {
    if (!canPost || !companyId) return;
    setSaving(true);
    setError("");
    const payload = {
      companyId,
      date,
      memo,
      lines: lines
        .filter((l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)
        .map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId || null,
          department: l.department || null,
          description: l.description || null,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
        })),
    };
    try {
      if (isEdit) await updateJournalEntry(editingEntry.id, payload);
      else await createJournalEntry(payload);
      onSaved(isEdit ? "تم حفظ تعديلات القيد." : "تم إنشاء القيد وترحيله.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="invoice-modal-overlay">
      <div className="invoice-modal-box">
        <h3>{isEdit ? "تعديل القيد" : "إضافة قيد يومية"}</h3>
        {isEdit && <div className="edit-banner">تعديل القيد (فك ترحيله أولاً إن كان مرحّلاً)</div>}

        <div className="form-grid header-grid">
          <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">بيان القيد<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="وصف عام للقيد" /></label>
        </div>

        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead>
              <tr><th>الحساب</th><th>مركز التكلفة</th><th>القسم</th><th>الوصف</th><th>مدين</th><th>دائن</th><th></th></tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td>
                    <select value={l.accountId} onChange={(e) => updateLine(idx, "accountId", e.target.value)}>
                      <option value="">— اختر —</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={l.costCenterId} onChange={(e) => updateLine(idx, "costCenterId", e.target.value)}>
                      <option value="">— بدون —</option>
                      {costCenterOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><input type="text" value={l.department} onChange={(e) => updateLine(idx, "department", e.target.value)} placeholder="اختياري" /></td>
                  <td><input type="text" value={l.description} onChange={(e) => updateLine(idx, "description", e.target.value)} placeholder="وصف خاص بهذا السطر" /></td>
                  <td><input type="number" className="amount-input" value={l.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)} placeholder="0.00" /></td>
                  <td><input type="number" className="amount-input" value={l.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)} placeholder="0.00" /></td>
                  <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="foot-label" colSpan={4}>الإجمالي</td>
                <td className="num">{fmt2(totalDebit)}</td>
                <td className="num">{fmt2(totalCredit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="journal-actions">
          <button className="btn-ghost" onClick={addLine}>+ إضافة سطر</button>
          <div className="balance-status">
            {diff === 0 && totalDebit > 0 && <span className="balance-ok">✓ القيد متوازن — جاهز للترحيل</span>}
            {diff !== 0 && <span className="balance-bad">الفرق بين المدين والدائن: {fmt2(Math.abs(diff))} ر.س</span>}
          </div>
        </div>

        {error && <p className="balance-bad">{error}</p>}

        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-primary" onClick={submit} disabled={!canPost || saving}>
            {saving ? "جارٍ الحفظ..." : isEdit ? "حفظ التعديلات" : "ترحيل القيد"}
          </button>
        </div>
      </div>
    </div>
  );
}
