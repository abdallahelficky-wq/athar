import React, { useEffect, useMemo, useRef, useState } from "react";
import { createJournalEntry, updateJournalEntry, postJournalEntry, getNextEntryNumber } from "../api/journalEntries";
import { fmt2 } from "../legacy/constants";
import AccountSearchSelect from "./shared/AccountSearchSelect";

const emptyLine = () => ({ accountId: "", costCenterId: "", description: "", debit: "", credit: "" });

const lineFromExisting = (l) => ({
  accountId: l.accountId,
  costCenterId: l.costCenterId || "",
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
 *
 * تدفّق إدخال بالكيبورد بالكامل (بلا لمس الماوس): ترتيب أعمدة كل سطر (الحساب ← مدين ← دائن ←
 * الوصف ← مركز التكلفة) يطابق ترتيب التاب المطلوب بالضبط (التاريخ ← البيان ← الحساب الأول ← مدين
 * ← دائن ← الوصف ← الحساب الثاني...)، لأن مركز التكلفة حقل ثانوي اختياري وُضِع أخيراً عمداً. Enter
 * داخل حقل الوصف يقفز لحساب السطر التالي (أو يضيف سطراً جديداً ويُركِّز عليه لو كان آخر سطر).
 * Ctrl/Cmd+S = حفظ، Ctrl/Cmd+Enter = حفظ وترحيل (preventDefault يمنع حوار حفظ الصفحة الافتراضي
 * للمتصفح لأول اختصار).
 */
export default function JournalEntryFormModal({ companyId, accounts, costCenters, editingEntry, duplicateEntry, onClose, onSaved }) {
  const isEdit = !!editingEntry;
  const seed = editingEntry || duplicateEntry;

  const [date, setDate] = useState(() => (isEdit ? seed.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [memo, setMemo] = useState(seed?.memo || "");
  const [lines, setLines] = useState(() => (seed ? seed.lines.map(lineFromExisting) : [emptyLine(), emptyLine()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [numberPreview, setNumberPreview] = useState(null); // { prefix, preview } من الخادم، بلا حجز فعلي

  const accountInputRefs = useRef([]);
  const descriptionInputRefs = useRef([]);
  const pendingFocusIndex = useRef(null);

  useEffect(() => {
    if (isEdit || !companyId) return;
    getNextEntryNumber(companyId).then(setNumberPreview).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, isEdit]);

  // تركيز تلقائي على حقل الحساب في السطر الأول عند فتح النافذة — لا حاجة لمسة ماوس أولى.
  useEffect(() => {
    accountInputRefs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pendingFocusIndex.current == null) return;
    accountInputRefs.current[pendingFocusIndex.current]?.focus();
    pendingFocusIndex.current = null;
  }, [lines]);

  // اختصارات حفظ سريعة تعمل من أي مكان داخل النافذة: Ctrl/Cmd+S = حفظ، Ctrl/Cmd+Enter = حفظ وترحيل
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "s") { e.preventDefault(); submit(false); }
      else if (e.key === "Enter") { e.preventDefault(); submit(true); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, date, memo, saving]);

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
  const addLine = () => {
    pendingFocusIndex.current = lines.length;
    setLines((prev) => [...prev, emptyLine()]);
  };
  const removeLine = (idx) => setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  // Enter داخل حقل "الوصف" (آخر حقل تفاعلي أساسي بكل سطر) ينقل مباشرة لحساب السطر التالي، أو
  // يضيف سطراً جديداً ويُركِّز عليه لو كان هذا آخر سطر — بلا حاجة لضغط "+ إضافة سطر" بالماوس.
  const onDescriptionKeyDown = (e, idx) => {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (idx === lines.length - 1) addLine();
    else accountInputRefs.current[idx + 1]?.focus();
  };

  const buildPayload = () => ({
    companyId,
    date,
    memo,
    lines: lines
      .filter((l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)
      .map((l) => ({
        accountId: l.accountId,
        costCenterId: l.costCenterId || null,
        description: l.description || null,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      })),
  });

  const submit = async (post) => {
    if (!canPost || !companyId || saving) return;
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await updateJournalEntry(editingEntry.id, buildPayload());
        if (post) await postJournalEntry(editingEntry.id);
        onSaved(post ? "تم حفظ التعديلات وترحيل القيد. لن يمكن تعديله مباشرة بعد الآن." : "تم حفظ تعديلات القيد.");
      } else {
        await createJournalEntry({ ...buildPayload(), post });
        onSaved(post
          ? duplicateEntry ? "تم إنشاء نسخة جديدة من القيد وترحيلها." : "تم إنشاء القيد وترحيله. لن يمكن تعديله مباشرة بعد الآن."
          : duplicateEntry ? "تم حفظ نسخة جديدة من القيد." : "تم حفظ القيد — يظهر فوراً في التقارير وكشوف الحسابات، وقابل للتعديل حتى يُرحَّل.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="invoice-modal-overlay">
      <div className="invoice-modal-box journal-modal-box">
        <h3>{isEdit ? "تعديل القيد" : duplicateEntry ? "نسخ القيد إلى قيد جديد" : "إضافة قيد يومية"}</h3>

        <div className="journal-modal-scroll">
          {duplicateEntry && <div className="edit-banner">تم نسخ بيانات القيد — راجعها قبل حفظ القيد الجديد</div>}

          <div className="form-grid header-grid">
            <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>
              رقم القيد
              <input
                type="text" disabled
                value={isEdit ? (editingEntry.entryNumber || editingEntry.id.slice(-8)) : (numberPreview?.preview || "—")}
                title={isEdit ? "" : "رقم معاينة فقط — لا يُحجز إلا لحظة الحفظ"}
              />
            </label>
            <label className="memo-field">بيان القيد<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="وصف عام للقيد" /></label>
          </div>

          <div className="lines-table-wrap">
            <table className="lines-table">
              <thead>
                <tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>الوصف</th><th>مركز التكلفة</th><th></th></tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td>
                      <AccountSearchSelect
                        ref={(el) => (accountInputRefs.current[idx] = el)}
                        accounts={accounts}
                        value={l.accountId}
                        onChange={(accountId) => updateLine(idx, "accountId", accountId)}
                      />
                    </td>
                    <td><input type="number" className="amount-input" value={l.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)} placeholder="0.00" /></td>
                    <td><input type="number" className="amount-input" value={l.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)} placeholder="0.00" /></td>
                    <td>
                      <input
                        ref={(el) => (descriptionInputRefs.current[idx] = el)}
                        type="text" value={l.description}
                        onChange={(e) => updateLine(idx, "description", e.target.value)}
                        onKeyDown={(e) => onDescriptionKeyDown(e, idx)}
                        placeholder="وصف خاص بهذا السطر"
                      />
                    </td>
                    <td>
                      <select value={l.costCenterId} onChange={(e) => updateLine(idx, "costCenterId", e.target.value)}>
                        <option value="">— بدون —</option>
                        {costCenterOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td><button type="button" className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="foot-label">الإجمالي</td>
                  <td className="num">{fmt2(totalDebit)}</td>
                  <td className="num">{fmt2(totalCredit)}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="journal-actions">
            <button type="button" className="btn-ghost" onClick={addLine}>+ إضافة سطر</button>
          </div>

          {error && <p className="balance-bad">{error}</p>}
        </div>

        <div className="journal-modal-footer">
          <div className="journal-actions" style={{ marginBottom: 12 }}>
            {diff === 0 && totalDebit > 0 && (
              <span className="balance-indicator indicator-ok">✓ القيد متوازن — جاهز للحفظ</span>
            )}
            {diff !== 0 && (
              <span className="balance-indicator indicator-bad">⚠ غير متوازن بفرق {fmt2(Math.abs(diff))} ر.س</span>
            )}
            {diff === 0 && totalDebit === 0 && (
              <span className="balance-indicator indicator-neutral">أدخل مبالغ السطور لعرض حالة التوازن</span>
            )}
          </div>

          <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
            <p className="journal-shortcuts-hint">
              اختصارات: <kbd>Ctrl</kbd>+<kbd>S</kbd> حفظ · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> حفظ وترحيل · <kbd>Enter</kbd> في "الوصف" يضيف سطراً جديداً
            </p>
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
              <button className="btn-secondary" onClick={() => submit(false)} disabled={!canPost || saving}>
                {saving ? "جارٍ الحفظ..." : "حفظ"}
              </button>
              <button className="btn-primary" onClick={() => submit(true)} disabled={!canPost || saving}>
                {saving ? "جارٍ الحفظ..." : "حفظ وترحيل"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
