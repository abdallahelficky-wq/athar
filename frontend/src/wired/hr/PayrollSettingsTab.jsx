import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../../api/accounts";
import {
  listPayrollComponents, createPayrollComponent, updatePayrollComponent, deletePayrollComponent,
  getPayrollSettings, updatePayrollSettings,
} from "../../api/payrollSettings";
import AccountSearchSelect from "../shared/AccountSearchSelect";

const GROSS_TOTAL_REF = "system:GROSS_TOTAL";
const encodeRef = (ref) => (ref.kind === "system" ? GROSS_TOTAL_REF : `component:${ref.componentId}`);
const decodeRef = (value) => (value === GROSS_TOTAL_REF ? { kind: "system", key: "GROSS_TOTAL" } : { kind: "component", componentId: value.slice("component:".length) });

const emptyTerm = () => ({ quantity: "1", unitType: "", referenceValue: GROSS_TOTAL_REF });

const emptyForm = () => ({
  name: "", kind: "addition", accountId: "", calcMethod: "fixed",
  terms: [emptyTerm()],
  adjustmentEnabled: false, adjustmentUnitType: "day", adjustmentRefIds: [],
  allowsMonthlyAdjustments: true, prorateOnPartialMonth: false, appliesByDefault: true,
});

/**
 * شاشة "إعدادات الرواتب" — تحوّل كل بنود الراتب (الأساسي والبدلات والتأمينات والاستقطاعات) من حقول
 * ثابتة في الكود إلى بنود قابلة للتعديل الكامل: اسم، نوع، حساب محاسبي، وطريقة حساب (قيمة ثابتة لكل
 * موظف، أو صيغة مركّبة من عدد غير محدود من البنود الفرعية، كل بند فرعي = كمية × مرجع، مع تحويل
 * اختياري لسعر الساعة/اليوم عبر ساعات/أيام الشهر القياسية). التغيير هنا لا يمسّ رواتب أي شركة لم
 * تُنشئ بنوداً بعد (تبقى تعمل بالمنطق القديم تلقائياً حتى تُضاف بنودها هنا لأول مرة).
 */
export default function PayrollSettingsTab({ companyId }) {
  const { t } = useTranslation();
  const KIND_LABELS = t("hr.payrollSettings.kindLabels", { returnObjects: true });
  const [components, setComponents] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState({ standardHoursPerMonth: "240", standardDaysPerMonth: "30" });
  const [payslipColumns, setPayslipColumns] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");

  const reload = () => {
    if (!companyId) return;
    listPayrollComponents(companyId).then(setComponents).catch((e) => setError(e.message));
  };
  useEffect(reload, [companyId]);
  useEffect(() => { if (companyId) listAccounts({ companyId }).then(setAccounts); }, [companyId]);
  useEffect(() => {
    if (!companyId) return;
    getPayrollSettings(companyId).then((s) => {
      setSettings(s);
      setSettingsDraft({ standardHoursPerMonth: String(s.standardHoursPerMonth), standardDaysPerMonth: String(s.standardDaysPerMonth) });
      setPayslipColumns(s.payslipColumns?.length ? s.payslipColumns : []);
    }).catch((e) => setError(e.message));
  }, [companyId]);

  const postingAccounts = useMemo(() => accounts.filter((a) => a.isPosting && !a.isArchived), [accounts]);
  const activeComponents = useMemo(() => components.filter((c) => c.isActive), [components]);
  // مرجع الصيغة يمكن أن يكون "الإجمالي" أو أي بند آخر (باستثناء البند نفسه أثناء التعديل، لمنع مرجع ذاتي مباشر)
  const referenceOptions = useMemo(() => components.filter((c) => c.id !== editingId), [components, editingId]);

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setFormOpen(true); };
  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({
      name: c.name, kind: c.kind, accountId: c.accountId, calcMethod: c.calcMethod,
      terms: c.formula?.terms?.length ? c.formula.terms.map((t) => ({ quantity: String(t.quantity), unitType: t.unitType || "", referenceValue: encodeRef(t.reference) })) : [emptyTerm()],
      adjustmentEnabled: !!c.adjustmentUnitBasis, adjustmentUnitType: c.adjustmentUnitBasis?.unitType || "day",
      adjustmentRefIds: c.adjustmentUnitBasis?.referenceComponentIds || [],
      allowsMonthlyAdjustments: c.allowsMonthlyAdjustments, prorateOnPartialMonth: c.prorateOnPartialMonth, appliesByDefault: c.appliesByDefault,
    });
    setFormOpen(true);
  };

  const addTerm = () => setForm((f) => ({ ...f, terms: [...f.terms, emptyTerm()] }));
  const updateTerm = (idx, field, value) => setForm((f) => ({ ...f, terms: f.terms.map((t, i) => (i === idx ? { ...t, [field]: value } : t)) }));
  const removeTerm = (idx) => setForm((f) => ({ ...f, terms: f.terms.filter((_, i) => i !== idx) }));

  const toggleAdjustmentRef = (id) => setForm((f) => ({
    ...f, adjustmentRefIds: f.adjustmentRefIds.includes(id) ? f.adjustmentRefIds.filter((x) => x !== id) : [...f.adjustmentRefIds, id],
  }));

  const save = async () => {
    if (!form.name.trim() || !form.accountId) { setError(t("hr.payrollSettings.errNameAccountRequired")); return; }
    const payload = {
      name: form.name.trim(), kind: form.kind, accountId: form.accountId, calcMethod: form.calcMethod,
      formula: form.calcMethod === "formula"
        ? { terms: form.terms.filter((t) => t.quantity !== "" && t.referenceValue).map((t) => ({ quantity: Number(t.quantity), unitType: t.unitType || null, reference: decodeRef(t.referenceValue) })) }
        : null,
      adjustmentUnitBasis: form.adjustmentEnabled && form.adjustmentRefIds.length
        ? { unitType: form.adjustmentUnitType, referenceComponentIds: form.adjustmentRefIds }
        : null,
      allowsMonthlyAdjustments: form.allowsMonthlyAdjustments, prorateOnPartialMonth: form.prorateOnPartialMonth, appliesByDefault: form.appliesByDefault,
    };
    try {
      if (editingId) await updatePayrollComponent(editingId, payload);
      else await createPayrollComponent(companyId, { ...payload, sortOrder: components.length });
      setFormOpen(false); setError("");
      reload();
    } catch (err) { setError(err.message); }
  };

  const remove = async (c) => {
    if (!window.confirm(t("hr.payrollSettings.confirmDelete", { name: c.name }))) return;
    try { await deletePayrollComponent(c.id); reload(); } catch (err) { setError(err.message); }
  };

  const toggleActive = async (c) => {
    try { await updatePayrollComponent(c.id, { isActive: !c.isActive }); reload(); } catch (err) { setError(err.message); }
  };

  const move = async (c, direction) => {
    const ordered = [...components].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = ordered.findIndex((x) => x.id === c.id);
    const swapWith = ordered[idx + direction];
    if (!swapWith) return;
    try {
      await Promise.all([
        updatePayrollComponent(c.id, { sortOrder: swapWith.sortOrder }),
        updatePayrollComponent(swapWith.id, { sortOrder: c.sortOrder }),
      ]);
      reload();
    } catch (err) { setError(err.message); }
  };

  const saveSettings = async () => {
    try {
      await updatePayrollSettings(companyId, {
        standardHoursPerMonth: Number(settingsDraft.standardHoursPerMonth), standardDaysPerMonth: Number(settingsDraft.standardDaysPerMonth),
      });
      setError("");
    } catch (err) { setError(err.message); }
  };

  const addPayslipColumn = () => {
    const next = activeComponents.find((c) => !payslipColumns.some((p) => p.componentId === c.id));
    if (!next) return;
    setPayslipColumns((cols) => [...cols, { componentId: next.id, label: next.name }]);
  };
  const updatePayslipColumn = (idx, field, value) => setPayslipColumns((cols) => cols.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  const removePayslipColumn = (idx) => setPayslipColumns((cols) => cols.filter((_, i) => i !== idx));
  const movePayslipColumn = (idx, direction) => setPayslipColumns((cols) => {
    const next = [...cols];
    const target = idx + direction;
    if (target < 0 || target >= next.length) return cols;
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
  });
  const savePayslipColumns = async () => {
    try { await updatePayrollSettings(companyId, { payslipColumns }); setError(""); } catch (err) { setError(err.message); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      {error && <p className="balance-bad">{error}</p>}

      <div className="panel form-panel">
        <h3 className="sub-head">{t("hr.payrollSettings.standardTitle")}</h3>
        <p className="note">{t("hr.payrollSettings.standardNote")}</p>
        <div className="form-grid">
          <label>{t("hr.payrollSettings.standardHours")}<input type="number" value={settingsDraft.standardHoursPerMonth} onChange={(e) => setSettingsDraft({ ...settingsDraft, standardHoursPerMonth: e.target.value })} /></label>
          <label>{t("hr.payrollSettings.standardDays")}<input type="number" value={settingsDraft.standardDaysPerMonth} onChange={(e) => setSettingsDraft({ ...settingsDraft, standardDaysPerMonth: e.target.value })} /></label>
        </div>
        <button className="btn-primary" onClick={saveSettings}>{t("common.save")}</button>
      </div>

      <div className="panel">
        <div className="items-form-heading"><strong>{t("hr.payrollSettings.componentsTitle")}</strong><button className="btn-primary" onClick={openNew}>{t("hr.payrollSettings.newComponent")}</button></div>
        {components.length === 0 && (
          <p className="note balance-bad">{t("hr.payrollSettings.noComponentsWarning")}</p>
        )}
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>{t("hr.payrollSettings.table.name")}</th><th>{t("hr.payrollSettings.table.kind")}</th><th>{t("hr.payrollSettings.table.account")}</th><th>{t("hr.payrollSettings.table.calcMethod")}</th><th>{t("hr.payrollSettings.table.monthlyAdjustment")}</th><th>{t("hr.payrollSettings.table.status")}</th><th></th></tr></thead>
            <tbody>
              {[...components].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}{c.isSystem && <small>{t("hr.payrollSettings.systemTag")}</small>}</td>
                  <td>{KIND_LABELS[c.kind]}</td>
                  <td>{c.account?.code} — {c.account?.name}</td>
                  <td>{c.calcMethod === "formula" ? t("hr.payrollSettings.calcMethodFormula") : t("hr.payrollSettings.calcMethodFixed")}</td>
                  <td>{c.allowsMonthlyAdjustments ? t("hr.payrollSettings.yes") : "—"}</td>
                  <td><span className="status-badge">{c.isActive ? t("hr.payrollSettings.statusActive") : t("hr.payrollSettings.statusStopped")}</span></td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => move(c, -1)} title={t("hr.payrollSettings.moveUp")}>↑</button>
                    <button className="btn-ghost" onClick={() => move(c, 1)} title={t("hr.payrollSettings.moveDown")}>↓</button>
                    <button className="btn-ghost" onClick={() => startEdit(c)}>{t("common.edit")}</button>
                    <button className="btn-ghost" onClick={() => toggleActive(c)}>{c.isActive ? t("hr.payrollSettings.deactivate") : t("hr.payrollSettings.activate")}</button>
                    {!c.isSystem && <button className="btn-ghost" onClick={() => remove(c)}>{t("common.delete")}</button>}
                  </td>
                </tr>
              ))}
              {components.length === 0 && <tr><td className="empty" colSpan={7}>{t("hr.payrollSettings.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {formOpen && (
        <div className="panel form-panel">
          <div className="items-form-heading"><strong>{editingId ? t("hr.payrollSettings.formTitleEdit", { name: form.name }) : t("hr.payrollSettings.formTitleNew")}</strong><button className="item-close" onClick={() => setFormOpen(false)}>×</button></div>
          <div className="form-grid">
            <label>{t("hr.payrollSettings.fieldName")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>{t("hr.payrollSettings.fieldKind")}
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="addition">{t("hr.payrollSettings.kindLabels.addition")}</option><option value="deduction">{t("hr.payrollSettings.kindLabels.deduction")}</option>
              </select>
            </label>
            <label>{t("hr.payrollSettings.fieldAccount")}<AccountSearchSelect accounts={postingAccounts} value={form.accountId} onChange={(id) => setForm({ ...form, accountId: id })} /></label>
            <label>{t("hr.payrollSettings.fieldCalcMethod")}
              <select value={form.calcMethod} onChange={(e) => setForm({ ...form, calcMethod: e.target.value })}>
                <option value="fixed">{t("hr.payrollSettings.calcMethodFixedOption")}</option>
                <option value="formula">{t("hr.payrollSettings.calcMethodFormulaOption")}</option>
              </select>
            </label>
          </div>

          {form.calcMethod === "formula" && (
            <>
              <h3 className="sub-head">{t("hr.payrollSettings.formulaTitle")}</h3>
              <div className="lines-table-wrap">
                <table className="lines-table">
                  <thead><tr><th>{t("hr.payrollSettings.formulaTable.quantity")}</th><th>{t("hr.payrollSettings.formulaTable.unit")}</th><th>{t("hr.payrollSettings.formulaTable.reference")}</th><th></th></tr></thead>
                  <tbody>
                    {form.terms.map((t2, idx) => (
                      <tr key={idx}>
                        <td><input type="number" step="0.01" value={t2.quantity} onChange={(e) => updateTerm(idx, "quantity", e.target.value)} /></td>
                        <td>
                          <select value={t2.unitType} onChange={(e) => updateTerm(idx, "unitType", e.target.value)}>
                            <option value="">{t("hr.payrollSettings.unitDirect")}</option>
                            <option value="hour">{t("hr.payrollSettings.unitHourPrice")}</option>
                            <option value="day">{t("hr.payrollSettings.unitDayPrice")}</option>
                          </select>
                        </td>
                        <td>
                          <select value={t2.referenceValue} onChange={(e) => updateTerm(idx, "referenceValue", e.target.value)}>
                            <option value={GROSS_TOTAL_REF}>{t("hr.payrollSettings.referenceGrossTotal")}</option>
                            {referenceOptions.map((c) => <option key={c.id} value={`component:${c.id}`}>{c.name}</option>)}
                          </select>
                        </td>
                        <td><button className="btn-remove-line" onClick={() => removeTerm(idx)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn-ghost" onClick={addTerm}>{t("hr.payrollSettings.addFormulaTerm")}</button>
              <p className="note">{t("hr.payrollSettings.formulaExampleNote")}</p>
            </>
          )}

          <label className="checkbox-field" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={form.adjustmentEnabled} onChange={(e) => setForm({ ...form, adjustmentEnabled: e.target.checked })} />
            {t("hr.payrollSettings.adjustmentToggle")}
          </label>
          {form.adjustmentEnabled && (
            <div className="form-grid">
              <label>{t("hr.payrollSettings.adjustmentUnitLabel")}
                <select value={form.adjustmentUnitType} onChange={(e) => setForm({ ...form, adjustmentUnitType: e.target.value })}>
                  <option value="day">{t("hr.payrollSettings.adjustmentUnitDay")}</option><option value="hour">{t("hr.payrollSettings.adjustmentUnitHour")}</option>
                </select>
              </label>
              <div className="employee-checklist">
                {referenceOptions.map((c) => (
                  <label key={c.id} className="checkbox-field"><input type="checkbox" checked={form.adjustmentRefIds.includes(c.id)} onChange={() => toggleAdjustmentRef(c.id)} /> {c.name}</label>
                ))}
              </div>
            </div>
          )}

          <div className="form-grid" style={{ marginTop: 14 }}>
            <label className="checkbox-field"><input type="checkbox" checked={form.allowsMonthlyAdjustments} onChange={(e) => setForm({ ...form, allowsMonthlyAdjustments: e.target.checked })} /> {t("hr.payrollSettings.allowsMonthlyAdjustments")}</label>
            <label className="checkbox-field"><input type="checkbox" checked={form.prorateOnPartialMonth} onChange={(e) => setForm({ ...form, prorateOnPartialMonth: e.target.checked })} /> {t("hr.payrollSettings.prorateOnPartialMonth")}</label>
            <label className="checkbox-field"><input type="checkbox" checked={form.appliesByDefault} onChange={(e) => setForm({ ...form, appliesByDefault: e.target.checked })} /> {t("hr.payrollSettings.appliesByDefault")}</label>
          </div>

          <div className="form-btn-group"><button className="btn-ghost" onClick={() => setFormOpen(false)}>{t("common.cancel")}</button><button className="btn-primary" onClick={save}>{editingId ? t("hr.payrollSettings.saveChanges") : t("hr.payrollSettings.saveNew")}</button></div>
        </div>
      )}

      <div className="panel">
        <h3 className="sub-head">{t("hr.payrollSettings.payslipColumnsTitle")}</h3>
        <p className="note">{t("hr.payrollSettings.payslipColumnsNote")}</p>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>{t("hr.payrollSettings.payslipTable.component")}</th><th>{t("hr.payrollSettings.payslipTable.columnTitle")}</th><th></th></tr></thead>
            <tbody>
              {payslipColumns.map((col, idx) => (
                <tr key={idx}>
                  <td>
                    <select value={col.componentId || ""} onChange={(e) => updatePayslipColumn(idx, "componentId", e.target.value)}>
                      {activeComponents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><input type="text" value={col.label} onChange={(e) => updatePayslipColumn(idx, "label", e.target.value)} /></td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => movePayslipColumn(idx, -1)} title={t("hr.payrollSettings.moveUp")}>↑</button>
                    <button className="btn-ghost" onClick={() => movePayslipColumn(idx, 1)} title={t("hr.payrollSettings.moveDown")}>↓</button>
                    <button className="btn-remove-line" onClick={() => removePayslipColumn(idx)}>✕</button>
                  </td>
                </tr>
              ))}
              {payslipColumns.length === 0 && <tr><td className="empty" colSpan={3}>{t("hr.payrollSettings.payslipEmpty")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={addPayslipColumn} disabled={activeComponents.every((c) => payslipColumns.some((p) => p.componentId === c.id))}>{t("hr.payrollSettings.addColumn")}</button>
          <button className="btn-primary" onClick={savePayslipColumns}>{t("hr.payrollSettings.saveColumnsOrder")}</button>
        </div>
      </div>
    </div>
  );
}
