import React, { useEffect, useMemo, useState } from "react";
import { createJournalEntry, updateJournalEntry, postJournalEntry, getNextEntryNumber } from "../api/journalEntries";
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
 *
 * دورة الحياة الجديدة بلا "مسودة": زرّان منفصلان — "حفظ" يُنشئ/يُبقي القيد بحالة "محفوظ" (قابل
 * للتعديل، يؤثر على كل التقارير فوراً)، و"حفظ وترحيل" يُرحِّله مباشرة فيُقفَل تماماً بعدها (أي
 * تصحيح لاحق يكون فقط عبر عكس القيد من شاشة القائمة). القيد المرحّل لا يُفتَح في هذه النافذة
 * للتعديل أصلاً (الأيقونة تُعطَّل من شاشة القائمة نفسها).
 */
export default function JournalEntryFormModal({ companyId, accounts, costCenters, editingEntry, onClose, onSaved }) {
  const isEdit = !!editingEntry;

  const [date, setDate] = useState(() => (isEdit ? editingEntry.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [memo, setMemo] = useState(editingEntry?.memo || "");
  const [lines, setLines] = useState(() => (isEdit ? editingEntry.lines.map(lineFromExisting) : [emptyLine(), emptyLine()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [numberPreview, setNumberPreview] = useState(null); // { prefix, preview } من الخادم، بلا حجز فعلي

  useEffect(() => {
    if (isEdit || !companyId) return;
    getNextEntryNumber(companyId).then(setNumberPreview).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, isEdit]);

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

  const buildPayload = () => ({
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
  });

  const submit = async (post) => {
    if (!canPost || !companyId) return;
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await updateJournalEntry(editingEntry.id, buildPayload());
        if (post) await postJournalEntry(editingEntry.id);
        onSaved(post ? "تم حفظ التعديلات وترحيل القيد. لن يمكن تعديله مباشرة بعد الآن." : "تم حفظ تعديلات القيد.");
      } else {
        await createJournalEntry({ ...buildPayload(), post });
        onSaved(post ? "تم إنشاء القيد وترحيله. لن يمكن تعديله مباشرة بعد الآن." : "تم حفظ القيد — يظهر فوراً في التقارير وكشوف الحسابات، وقابل للتعديل حتى يُرحَّل.");
      }
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

        {isEdit ? (
          <p className="note">رقم القيد: <strong>{editingEntry.entryNumber || editingEntry.id.slice(-8)}</strong></p>
        ) : numberPreview?.preview ? (
          <p className="note">
            الرقم المتوقع لهذا القيد: <strong>{numberPreview.preview}</strong> — رقم معاينة فقط، لا يُحجز إلا لحظة الضغط
            على "حفظ" أو "حفظ وترحيل"؛ لو ألغيت العملية الآن يبقى متاحاً للقيد التالي.
          </p>
        ) : numberPreview && !numberPreview.prefix ? (
          <p className="note">
            لم تُحدَّد بعد بادئة ترقيم لهذه الشركة، فسيُستخدم معرّف مؤقت للقيد حتى تُحدَّد من بيانات الشركة.
          </p>
        ) : null}

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
            {diff === 0 && totalDebit > 0 && <span className="balance-ok">✓ القيد متوازن</span>}
            {diff !== 0 && <span className="balance-bad">الفرق بين المدين والدائن: {fmt2(Math.abs(diff))} ر.س</span>}
          </div>
        </div>

        {error && <p className="balance-bad">{error}</p>}

        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-ghost" onClick={() => submit(false)} disabled={!canPost || saving}>
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </button>
          <button className="btn-primary" onClick={() => submit(true)} disabled={!canPost || saving}>
            {saving ? "جارٍ الحفظ..." : "حفظ وترحيل"}
          </button>
        </div>
      </div>
    </div>
  );
}
