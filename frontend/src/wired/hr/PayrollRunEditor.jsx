import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { listEmployees } from "../../api/employees";
import {
  listPayrollRuns, createPayrollRun, getPayrollRunRows, updatePayrollRunEmployees,
  setPayrollRowOverride, clearPayrollRowOverride, postPayrollRun, unpostPayrollRun,
  postponeAdvanceInstallment, undoAdvancePostponement,
} from "../../api/payrollRuns";
import { getPayrollSettings } from "../../api/payrollSettings";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import PayrollPrintModal from "./PayrollPrintModal";
import { useDeferredFilters } from "../shared/useDeferredFilters";

/** يبني أعمدة العرض الفعلية: تخصيص الشركة (PayrollSettings.payslipColumns — ترتيب وتسمية مختارة)
 * إن وُجد، وإلا كل بنود الكشف (columns من getPayrollRunRows) بترتيبها الافتراضي. */
function buildDisplayColumns(columns, payslipColumns) {
  if (!payslipColumns?.length) return columns;
  const byId = new Map(columns.map((c) => [c.id, c]));
  return payslipColumns.filter((pc) => byId.has(pc.componentId)).map((pc) => ({ id: pc.componentId, name: pc.label, kind: byId.get(pc.componentId).kind }));
}

export default function PayrollRunEditor({ companyId, companies, initialMonth, onChanged, onDelete }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const [scopeEditing, setScopeEditing] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [employees, setEmployees] = useState([]);
  // ?month= يأتي من رابط قيد الرواتب في شاشة القيود (الانتقال من القيد إلى كشفه)
  const [searchParams] = useSearchParams();
  const linkedMonth = /^\d{4}-\d{2}$/.test(searchParams.get("month") || "") ? searchParams.get("month") : null;
  const mf = useDeferredFilters({ month: initialMonth || linkedMonth || new Date().toISOString().slice(0, 7) });
  const [scope, setScope] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [run, setRun] = useState(null);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [columns, setColumns] = useState([]);
  const [warnings, setWarnings] = useState(null);
  const [payslipColumns, setPayslipColumns] = useState([]);
  const [error, setError] = useState("");
  const [unpostOpen, setUnpostOpen] = useState(false);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    listEmployees(companyId).then(setEmployees).catch(e => setError(e.message));
    getPayrollSettings(companyId).then((s) => setPayslipColumns(s.payslipColumns || [])).catch(e => setError(e.message));
  }, [companyId]);

  useEffect(() => { setScopeEditing(false); setSelectedIds([]); setEditingRowId(null); setEditForm(null); setPrinting(false); }, [companyId, mf.applied.month]);

  const displayColumns = buildDisplayColumns(columns, payslipColumns);

  const reload = async () => {
    if (!companyId) return;
    setError("");
    const runs = await listPayrollRuns(companyId, mf.applied.month);
    const existing = runs[0] || null;
    setRun(existing);
    if (existing) {
      const data = await getPayrollRunRows(existing.id);
      setRows(data.rows);
      setTotals(data.totals);
      setColumns(data.columns);
      setWarnings(data.warnings || null);
    } else {
      setRows([]); setTotals(null); setColumns([]); setWarnings(null);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); reload().catch(err => setError(err.message)).finally(() => setLoading(false)); }, [companyId, mf.applied]);

  const toggleSelected = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const createRun = async () => {
    const ids = scope === "all" ? employees.map((e) => e.id) : selectedIds;
    if (ids.length === 0) return;
    try {
      await createPayrollRun({ companyId, month: mf.applied.month, employeeIds: ids });
      await reload(); onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveScope = async () => {
    setScopeSaving(true); setError("");
    try { await updatePayrollRunEmployees(run.id, selectedIds); setScopeEditing(false); await reload(); onChanged?.(); }
    catch (err) { setError(err.message); } finally { setScopeSaving(false); }
  };
  const startEditRow = (row) => { setEditingRowId(row.employeeId); setEditForm({ ...row.componentValues }); };
  const saveRowEdit = async () => {
    try {
      const override = {};
      columns.filter((col) => col.id !== "advances").forEach((col) => { override[col.id] = Number(editForm[col.id] || 0); });
      await setPayrollRowOverride(run.id, editingRowId, override);
      setEditingRowId(null);
      await reload(); onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };
  const clearOverride = async (employeeId) => {
    try {
      await clearPayrollRowOverride(run.id, employeeId);
      await reload(); onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };

  // «تأجيل القسط هذا الشهر»: صفر لهذه السلفة في هذا الكشف وحده، بسبب إلزامي — الرصيد لا يتغيّر والشهر التالي يعيده
  const postpone = async (advanceId) => {
    const reason = window.prompt(t("hr.payroll.advPostponeReason"));
    if (!reason || !reason.trim()) return;
    try { await postponeAdvanceInstallment(run.id, advanceId, reason.trim()); await reload(); onChanged?.(); }
    catch (err) { setError(err.message); }
  };
  const undoPostpone = async (advanceId) => {
    try { await undoAdvancePostponement(run.id, advanceId); await reload(); onChanged?.(); }
    catch (err) { setError(err.message); }
  };
  const advanceRows = rows.flatMap((r) => (r.advanceInstallments || []).map((i) => ({ ...i, employeeId: r.employeeId, employeeName: r.employeeName })));

  const doPost = async () => {
    if (busy || !window.confirm(ar ? "ترحيل المسير وإنشاء القيد المحاسبي؟" : "Post payroll and create the journal entry?")) return;
    setBusy(true);
    try {
      await postPayrollRun(run.id);
      await reload(); onChanged?.();
    } catch (err) {
      setError(err.message);
    }
    finally { setBusy(false); }
  };
  const doUnpost = async (pin) => {
    await unpostPayrollRun(run.id, pin);
    setUnpostOpen(false);
    await reload(); onChanged?.();
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  if (loading) return <p role="status">{ar ? "جارٍ تحميل المسير…" : "Loading payroll…"}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <form hidden={Boolean(initialMonth)} className="form-grid" onSubmit={(e) => { e.preventDefault(); mf.apply(); }}>
          <label>{t("hr.payroll.month")}<input type="month" value={mf.draft.month} onChange={(e) => mf.setField("month", e.target.value)} /></label>
          <button type="submit" className="btn-ghost" style={{ alignSelf: "end" }}>{t("hr.payroll.showResults")}</button>
        </form>

        {!run && (
          <>
            <div className="scope-row">
              <label className="scope-option"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> {t("hr.payroll.scopeAll")}</label>
              <label className="scope-option"><input type="radio" checked={scope === "some"} onChange={() => setScope("some")} /> {t("hr.payroll.scopeSome")}</label>
            </div>
            {scope === "some" && (
              <div className="employee-checklist">
                {employees.map((e) => (
                  <label key={e.id} className="checkbox-field"><input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleSelected(e.id)} /> {e.name}</label>
                ))}
              </div>
            )}
            <button className="btn-primary" onClick={createRun}>{t("hr.payroll.createRun")}</button>
          </>
        )}

        {run && (
          <div className="form-btn-group">
            {run.status === "draft" && <button className="btn-ghost" onClick={() => { setSelectedIds([...run.employeeIds]); setScopeEditing(true); }}>{ar ? "تعديل موظفي المسودة" : "Edit draft employees"}</button>}
            {run.status === "draft" && (
              <button className="btn-primary" onClick={doPost} disabled={busy || rows.length === 0}>{t("hr.payroll.postRun")}</button>
            )}
            {run.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostOpen(true)}>{t("hr.payroll.unpost")}</button>}
            <button className="icon-btn" title={t("hr.payroll.printTitle")} aria-label={t("hr.payroll.printTitle")} onClick={() => setPrinting(true)}><Icon.Printer /></button>
            {run.status === "draft" && onDelete && <button className="btn-ghost" onClick={() => onDelete(run)}>{ar ? "حذف المسودة" : "Delete draft"}</button>}
            <span className="status-badge">{run.status === "posted" ? t("hr.payroll.statusPosted") : t("hr.payroll.statusDraft")}</span>
          </div>
        )}
        {scopeEditing && run?.status === "draft" && <div className="panel">
          <p>{ar ? "تُحفظ تعديلات الرواتب الحالية. اختر الموظفين المطلوبين ثم احفظ المسودة." : "Existing payroll overrides are preserved. Select employees and save the draft."}</p>
          <button className="btn-ghost" onClick={() => setSelectedIds([...new Set([...selectedIds, ...employees.filter(e => e.status !== "terminated").map(e => e.id)])])}>{ar ? "إضافة جميع الموظفين النشطين" : "Add all active employees"}</button>
          <div className="employee-checklist">{employees.map(e => <label key={e.id}><input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleSelected(e.id)} disabled={scopeSaving} />{e.name}</label>)}</div>
          <button className="btn-primary" disabled={scopeSaving || !selectedIds.length} onClick={saveScope}>{t("common.save")}</button>
          <button className="btn-ghost" disabled={scopeSaving} onClick={() => setScopeEditing(false)}>{t("common.cancel")}</button>
        </div>}
        {error && <p className="balance-bad">{error}</p>}
        {run?.status === "draft" && warnings?.needsInstallment?.length > 0 && (
          <div className="note balance-bad" role="alert" data-testid="payroll-needs-installment-warning">
            <strong>{t("hr.payroll.advNeedsInstallmentTitle")}</strong>
            <ul>{warnings.needsInstallment.map((w) => <li key={w.advanceId}>{w.name} — {fmt(w.remainingBalance)}</li>)}</ul>
          </div>
        )}
        {run?.status === "draft" && warnings?.installmentOverMax?.length > 0 && (
          <div className="note" role="status" data-testid="payroll-installment-over-max-warning">
            <strong>{t("hr.payroll.advOverMaxTitle")}</strong>
            <ul>{warnings.installmentOverMax.map((w) => <li key={w.employeeId}>{t("hr.payroll.advOverMaxItem", { name: w.name, installments: fmt(w.installments), gross: fmt(w.gross), maxPercent: w.maxPercent })}</li>)}</ul>
          </div>
        )}
        {run?.status === "draft" && warnings?.unallocatedEmployees?.length > 0 && (
          <div className="note balance-bad" role="alert" data-testid="payroll-unallocated-warning">
            <strong>{t("hr.payroll.unallocatedTitle", { count: warnings.unallocatedEmployees.length })}</strong>
            <ul>
              {warnings.unallocatedEmployees.map((w) => (
                <li key={w.employeeId}>{w.name} — {[w.missingDepartment && t("hr.payroll.missingDepartment"), w.missingCostCenter && t("hr.payroll.missingCostCenter")].filter(Boolean).join("، ")}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {run && (
        <div className="panel">
          <div className="lines-table-wrap">
            <table className="lines-table">
              <thead>
                <tr>
                  <th>{t("hr.payroll.employee")}</th>
                  {displayColumns.map((col) => <th key={col.id}>{col.name}</th>)}
                  <th>{t("hr.payroll.net")}</th>
                  {run.status === "draft" && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td>{r.employeeName}{r.overridden && " *"}</td>
                    {displayColumns.map((col) => (
                      <td key={col.id} className="num">
                        {editingRowId === r.employeeId && col.id !== "advances" /* الأقساط تُحسَب من السلف وتُؤجَّل أدناه، لا تُعدَّل يدوياً */
                          ? <input type="number" className="amount-input" value={editForm[col.id] ?? 0} onChange={(e) => setEditForm({ ...editForm, [col.id]: e.target.value })} />
                          : fmt(r.componentValues[col.id] || 0)}
                      </td>
                    ))}
                    <td className="num strong">{fmt(r.net)}</td>
                    {run.status === "draft" && (
                      <td className="row-actions">
                        {editingRowId === r.employeeId ? (
                          <>
                            <button className="btn-ghost" onClick={saveRowEdit}>{t("hr.payroll.save")}</button>
                            <button className="btn-ghost" onClick={() => setEditingRowId(null)}>{t("hr.payroll.cancel")}</button>
                          </>
                        ) : (
                          <>
                            <button className="btn-ghost" onClick={() => startEditRow(r)}>{t("hr.payroll.edit")}</button>
                            {r.overridden && <button className="btn-ghost" onClick={() => clearOverride(r.employeeId)}>{t("hr.payroll.restore")}</button>}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="empty" colSpan={displayColumns.length + 3}>{t("hr.payroll.empty")}</td></tr>}
              </tbody>
              {totals && (
                <tfoot>
                  <tr>
                    <td className="foot-label">{t("hr.payroll.total")}</td>
                    {displayColumns.map((col) => <td key={col.id} className="num">{fmt(totals.byComponent[col.id] || 0)}</td>)}
                    <td className="num strong">{fmt(totals.net)}</td>
                    {run.status === "draft" && <td></td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {run && advanceRows.length > 0 && (
        <div className="panel" data-testid="payroll-advance-installments">
          <h3 className="sub-head">{t("hr.payroll.advTitle")}</h3>
          <div className="lines-table-wrap">
            <table className="lines-table">
              <thead><tr><th>{t("hr.payroll.advEmployee")}</th><th>{t("hr.payroll.advRemaining")}</th><th>{t("hr.payroll.advInstallment")}</th><th>{t("hr.payroll.advThisRun")}</th><th>{t("hr.payroll.advStatus")}</th>{run.status === "draft" && <th></th>}</tr></thead>
              <tbody>
                {advanceRows.map((a) => (
                  <tr key={a.advanceId}>
                    <td>{a.employeeName}</td>
                    <td className="num">{fmt(a.remainingBalance)}</td>
                    <td className="num">{a.monthlyInstallment == null ? "—" : fmt(a.monthlyInstallment)}</td>
                    <td className="num strong">{fmt(a.amount)}</td>
                    <td>{a.postponed ? t("hr.payroll.advPostponedBy", { reason: a.postponed.reason }) : a.needsInstallment ? t("hr.payroll.advNeedsInstallment") : ""}</td>
                    {run.status === "draft" && (
                      <td className="row-actions">
                        {a.postponed
                          ? <button className="btn-ghost" onClick={() => undoPostpone(a.advanceId)}>{t("hr.payroll.advUndoPostpone")}</button>
                          : !a.needsInstallment && <button className="btn-ghost" data-testid={`postpone-${a.advanceId}`} onClick={() => postpone(a.advanceId)}>{t("hr.payroll.advPostpone")}</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {run && <AttachmentsPanel entityType="payroll_run" entityId={run.id} />}

      {unpostOpen && <UnpostModal title={t("hr.payroll.unpostTitle")} onCancel={() => setUnpostOpen(false)} onConfirm={doUnpost} />}

      {printing && run && (
        <PayrollPrintModal
          run={run}
          rows={rows}
          totals={totals}
          columns={columns}
          month={mf.applied.month}
          company={companies?.find((c) => c.id === companyId)}
          autoPrint
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
