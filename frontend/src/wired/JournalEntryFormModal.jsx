import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createJournalEntry, updateJournalEntry, postJournalEntry, getNextEntryNumber } from "../api/journalEntries";
import { listFixedAssets } from "../api/fixedAssets";
import { listAssetCategories } from "../api/assetCategories";
import { listEmployeeAdvances } from "../api/employeeAdvances";
import { listEmployees } from "../api/employees";
import { fmt2 } from "../legacy/constants";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import FixedAssetLineModal from "./shared/FixedAssetLineModal";
import EmployeeAdvanceLineModal from "./shared/EmployeeAdvanceLineModal";
import { currencyLabel } from "../shared/countries";

const emptyLine = () => ({
  accountId: "", costCenterId: "", departmentId: "", description: "", debit: "", credit: "",
  employeeId: "", fixedAssetId: "", employeeAdvanceId: "", newFixedAsset: null, newEmployeeAdvance: null,
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
export default function JournalEntryFormModal({ companyId, companies, accounts, costCenters, departments, editingEntry, duplicateEntry, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const isEdit = !!editingEntry;
  const seed = editingEntry || duplicateEntry;

  const lineFromExisting = (l) => ({
    accountId: l.accountId,
    costCenterId: l.costCenterId || "",
    departmentId: l.departmentId || "",
    description: l.description || "",
    debit: Number(l.debit) || "",
    credit: Number(l.credit) || "",
    employeeId: l.employeeId || "",
    fixedAssetId: l.fixedAssetId || "",
    employeeAdvanceId: l.employeeAdvanceId || "",
    newFixedAsset: null,
    newEmployeeAdvance: null,
    // للعرض فقط (اسم الأصل/السلفة المرتبط) — لا يُرسَل للخادم عند الحفظ.
    linkedFixedAssetLabel: l.fixedAsset ? `${l.fixedAsset.assetNumber} — ${l.fixedAsset.name}` : "",
    linkedEmployeeAdvanceLabel: l.employeeAdvance ? t("journalEntries.form.advanceLabel", { amount: fmt2(l.employeeAdvance.amount), currency }) : "",
  });

  const [date, setDate] = useState(() => (isEdit ? seed.date.slice(0, 10) : new Date().toISOString().slice(0, 10)));
  const [memo, setMemo] = useState(seed?.memo || "");
  const [lines, setLines] = useState(() => (seed ? seed.lines.map(lineFromExisting) : [emptyLine(), emptyLine()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [numberPreview, setNumberPreview] = useState(null); // { prefix, preview } من الخادم، بلا حجز فعلي

  // بيانات نافذتَي "أصل ثابت/سلفة موظف" المنبثقتين — تُجلَب مرة واحدة عند فتح النافذة، لا لكل سطر.
  const [fixedAssets, setFixedAssets] = useState([]);
  const [assetCategories, setAssetCategories] = useState([]);
  const [employeeAdvances, setEmployeeAdvances] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [linkModal, setLinkModal] = useState(null); // { type: "asset" | "advance", lineIndex } | null

  const accountInputRefs = useRef([]);
  const descriptionInputRefs = useRef([]);
  const pendingFocusIndex = useRef(null);

  useEffect(() => {
    if (isEdit || !companyId) return;
    getNextEntryNumber(companyId).then(setNumberPreview).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, isEdit]);

  useEffect(() => {
    if (!companyId) return;
    listFixedAssets(companyId).then(setFixedAssets).catch(() => {});
    listAssetCategories(companyId).then(setAssetCategories).catch(() => {});
    listEmployeeAdvances(companyId).then(setEmployeeAdvances).catch(() => {});
    listEmployees(companyId).then(setEmployees).catch(() => {});
  }, [companyId]);

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
  const departmentOptions = useMemo(
    () => departments.filter((d) => !d.companyId || d.companyId === companyId),
    [departments, companyId],
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

  // اختيار حساب أصول ثابتة/سلف موظفين يفتح نافذة الربط تلقائياً؛ تغيير الحساب لأي حساب آخر يمسح
  // أي ربط سابق بهذا السطر (بلا حذف الأصل/السلفة نفسها، فقط إلغاء الوسم من هذا السطر تحديداً).
  const onAccountChange = (idx, accountId) => {
    const account = accounts.find((a) => a.id === accountId);
    setLines((prev) => prev.map((l, i) => (i === idx ? {
      ...l, accountId, fixedAssetId: "", employeeAdvanceId: "", newFixedAsset: null, newEmployeeAdvance: null,
      linkedFixedAssetLabel: "", linkedEmployeeAdvanceLabel: "",
    } : l)));
    if (account?.isFixedAssetAccount) setLinkModal({ type: "asset", lineIndex: idx });
    else if (account?.isEmployeeAdvanceAccount) setLinkModal({ type: "advance", lineIndex: idx });
  };

  const applyAssetLink = ({ fixedAssetId, newFixedAsset, debit }) => {
    const idx = linkModal.lineIndex;
    setLines((prev) => prev.map((l, i) => (i === idx ? {
      ...l, fixedAssetId: fixedAssetId || "", newFixedAsset,
      linkedFixedAssetLabel: fixedAssetId ? (fixedAssets.find((a) => a.id === fixedAssetId)?.name || "") : (newFixedAsset ? `${t("journalEntries.form.newAsset")} — ${newFixedAsset.name}` : ""),
      debit: debit != null ? debit : l.debit,
    } : l)));
    setLinkModal(null);
  };

  const applyAdvanceLink = ({ employeeAdvanceId, newEmployeeAdvance, debit, employeeId }) => {
    const idx = linkModal.lineIndex;
    setLines((prev) => prev.map((l, i) => (i === idx ? {
      ...l, employeeAdvanceId: employeeAdvanceId || "", newEmployeeAdvance, employeeId: employeeId || l.employeeId,
      linkedEmployeeAdvanceLabel: employeeAdvanceId ? t("journalEntries.form.existingAdvance") : (newEmployeeAdvance ? t("journalEntries.form.newAdvance") : ""),
      debit: debit != null ? debit : l.debit,
    } : l)));
    setLinkModal(null);
  };

  const clearLink = (idx) => setLines((prev) => prev.map((l, i) => (i === idx ? {
    ...l, fixedAssetId: "", employeeAdvanceId: "", newFixedAsset: null, newEmployeeAdvance: null,
    linkedFixedAssetLabel: "", linkedEmployeeAdvanceLabel: "",
  } : l)));

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
        departmentId: l.departmentId || null,
        description: l.description || null,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        employeeId: l.employeeId || null,
        fixedAssetId: l.fixedAssetId || null,
        employeeAdvanceId: l.employeeAdvanceId || null,
        newFixedAsset: l.newFixedAsset || null,
        newEmployeeAdvance: l.newEmployeeAdvance || null,
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
        onSaved(post ? t("journalEntries.form.savedEditPosted") : t("journalEntries.form.savedEditDraft"));
      } else {
        await createJournalEntry({ ...buildPayload(), post });
        onSaved(post
          ? duplicateEntry ? t("journalEntries.form.savedDuplicatePosted") : t("journalEntries.form.savedCreatePosted")
          : duplicateEntry ? t("journalEntries.form.savedDuplicateDraft") : t("journalEntries.form.savedCreateDraft"));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="invoice-modal-box journal-modal-box">
        <div className="modal-title-row">
          <h3>{isEdit ? t("journalEntries.form.titleEdit") : duplicateEntry ? t("journalEntries.form.titleDuplicate") : t("journalEntries.form.titleCreate")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("journalEntries.form.close")}>×</button>
        </div>

        <div className="journal-modal-scroll">
          {duplicateEntry && <div className="edit-banner">{t("journalEntries.form.duplicateBanner")}</div>}

          <div className="form-grid header-grid">
            <label>{t("journalEntries.form.date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>
              {t("journalEntries.form.entryNumber")}
              <input
                type="text" disabled
                value={isEdit ? (editingEntry.entryNumber || editingEntry.id.slice(-8)) : (numberPreview?.preview || "—")}
                title={isEdit ? "" : t("journalEntries.form.entryNumberPreviewTitle")}
              />
            </label>
            <label className="memo-field">{t("journalEntries.form.memo")}<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t("journalEntries.form.memoPlaceholder")} /></label>
          </div>

          <div className="lines-table-wrap">
            <table className="lines-table">
              <thead>
                <tr>
                  <th>{t("journalEntries.form.lines.account")}</th>
                  <th>{t("journalEntries.form.lines.debit")}</th>
                  <th>{t("journalEntries.form.lines.credit")}</th>
                  <th>{t("journalEntries.form.lines.description")}</th>
                  <th>{t("journalEntries.form.lines.costCenter")}</th>
                  <th>{t("journalEntries.form.lines.department")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td>
                      <AccountSearchSelect
                        ref={(el) => (accountInputRefs.current[idx] = el)}
                        accounts={accounts}
                        value={l.accountId}
                        onChange={(accountId) => onAccountChange(idx, accountId)}
                      />
                      {(l.fixedAssetId || l.newFixedAsset) && (
                        <div className="line-link-badge">
                          🔗 {l.linkedFixedAssetLabel || t("journalEntries.form.newAsset")}
                          <button type="button" className="btn-remove-line" onClick={() => clearLink(idx)} title={t("journalEntries.form.unlinkTitle")}>✕</button>
                        </div>
                      )}
                      {(l.employeeAdvanceId || l.newEmployeeAdvance) && (
                        <div className="line-link-badge">
                          🔗 {l.linkedEmployeeAdvanceLabel || t("journalEntries.form.newAdvance")}
                          <button type="button" className="btn-remove-line" onClick={() => clearLink(idx)} title={t("journalEntries.form.unlinkTitle")}>✕</button>
                        </div>
                      )}
                    </td>
                    <td><input type="number" className="amount-input" value={l.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)} placeholder="0.00" /></td>
                    <td><input type="number" className="amount-input" value={l.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)} placeholder="0.00" /></td>
                    <td>
                      <input
                        ref={(el) => (descriptionInputRefs.current[idx] = el)}
                        type="text" value={l.description}
                        onChange={(e) => updateLine(idx, "description", e.target.value)}
                        onKeyDown={(e) => onDescriptionKeyDown(e, idx)}
                        placeholder={t("journalEntries.form.descriptionPlaceholder")}
                      />
                    </td>
                    <td>
                      <select value={l.costCenterId} onChange={(e) => updateLine(idx, "costCenterId", e.target.value)}>
                        <option value="">{t("common.clearOption")}</option>
                        {costCenterOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={l.departmentId} onChange={(e) => updateLine(idx, "departmentId", e.target.value)}>
                        <option value="">{t("common.clearOption")}</option>
                        {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </td>
                    <td><button type="button" className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="foot-label">{t("journalEntries.form.total")}</td>
                  <td className="num">{fmt2(totalDebit)}</td>
                  <td className="num">{fmt2(totalCredit)}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="journal-actions">
            <button type="button" className="btn-ghost" onClick={addLine}>{t("journalEntries.form.addLine")}</button>
          </div>

          {error && <p className="balance-bad">{error}</p>}
        </div>

        <div className="journal-modal-footer">
          <div className="journal-actions" style={{ marginBottom: 12 }}>
            {diff === 0 && totalDebit > 0 && (
              <span className="balance-indicator indicator-ok">{t("journalEntries.form.balanced")}</span>
            )}
            {diff !== 0 && (
              <span className="balance-indicator indicator-bad">{t("journalEntries.form.unbalanced", { amount: fmt2(Math.abs(diff)), currency })}</span>
            )}
            {diff === 0 && totalDebit === 0 && (
              <span className="balance-indicator indicator-neutral">{t("journalEntries.form.enterAmounts")}</span>
            )}
          </div>

          <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
            <p className="journal-shortcuts-hint">{t("journalEntries.form.shortcutsHint")}</p>
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("journalEntries.form.cancel")}</button>
              <button className="btn-secondary" onClick={() => submit(false)} disabled={!canPost || saving}>
                {saving ? t("journalEntries.form.saving") : t("journalEntries.form.save")}
              </button>
              <button className="btn-primary" onClick={() => submit(true)} disabled={!canPost || saving}>
                {saving ? t("journalEntries.form.saving") : t("journalEntries.form.saveAndPost")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {linkModal?.type === "asset" && (
        <FixedAssetLineModal
          existingAssets={fixedAssets}
          assetCategories={assetCategories}
          lineAccountId={lines[linkModal.lineIndex]?.accountId}
          costCenters={costCenterOptions}
          employees={employees}
          initial={lines[linkModal.lineIndex]}
          onClose={() => { clearLink(linkModal.lineIndex); setLinkModal(null); }}
          onConfirm={applyAssetLink}
        />
      )}
      {linkModal?.type === "advance" && (
        <EmployeeAdvanceLineModal
          existingAdvances={employeeAdvances}
          employees={employees}
          initial={lines[linkModal.lineIndex]}
          onClose={() => { clearLink(linkModal.lineIndex); setLinkModal(null); }}
          onConfirm={applyAdvanceLink}
        />
      )}
    </div>
  );
}
