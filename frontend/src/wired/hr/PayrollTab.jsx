import React, { useEffect, useState } from "react";
import { listEmployees } from "../../api/employees";
import {
  listPayrollRuns, createPayrollRun, getPayrollRunRows, updatePayrollRunEmployees,
  setPayrollRowOverride, clearPayrollRowOverride, postPayrollRun, unpostPayrollRun,
} from "../../api/payrollRuns";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import PayrollPrintModal from "./PayrollPrintModal";
import { useDeferredFilters } from "../shared/useDeferredFilters";

const ROW_FIELDS = [
  ["basic", "الأساسي"], ["housing", "بدل سكن"], ["transport", "بدل مواصلات"], ["otherAllow", "بدلات أخرى"],
  ["otherAdd", "إضافات أخرى"], ["overtime", "بدل إضافي"], ["gosi", "تأمينات"], ["absence", "غياب"],
  ["advance", "سلف"], ["violation", "مخالفات"], ["penalty", "عقوبات"], ["otherDed", "خصومات أخرى"],
];

export default function PayrollTab({ companyId, companies }) {
  const [employees, setEmployees] = useState([]);
  const mf = useDeferredFilters({ month: "2026-07" });
  const [scope, setScope] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [run, setRun] = useState(null);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [error, setError] = useState("");
  const [unpostOpen, setUnpostOpen] = useState(false);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    listEmployees(companyId).then(setEmployees);
  }, [companyId]);

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
    } else {
      setRows([]); setTotals(null);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [companyId, mf.applied]);

  const toggleSelected = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const createRun = async () => {
    const ids = scope === "all" ? employees.map((e) => e.id) : selectedIds;
    if (ids.length === 0) return;
    try {
      await createPayrollRun({ companyId, month: mf.applied.month, employeeIds: ids });
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEditRow = (row) => { setEditingRowId(row.employeeId); setEditForm({ ...row }); };
  const saveRowEdit = async () => {
    try {
      const override = {};
      ROW_FIELDS.forEach(([f]) => { override[f] = Number(editForm[f] || 0); });
      await setPayrollRowOverride(run.id, editingRowId, override);
      setEditingRowId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };
  const clearOverride = async (employeeId) => {
    try {
      await clearPayrollRowOverride(run.id, employeeId);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doPost = async () => {
    try {
      await postPayrollRun(run.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };
  const doUnpost = async (pin) => {
    await unpostPayrollRun(run.id, pin);
    setUnpostOpen(false);
    reload();
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mf.apply(); }}>
          <label>شهر الرواتب<input type="month" value={mf.draft.month} onChange={(e) => mf.setField("month", e.target.value)} /></label>
          <button type="submit" className="btn-ghost" style={{ alignSelf: "end" }}>إظهار النتائج</button>
        </form>

        {!run && (
          <>
            <div className="scope-row">
              <label className="scope-option"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> كل الموظفين</label>
              <label className="scope-option"><input type="radio" checked={scope === "some"} onChange={() => setScope("some")} /> مجموعة محددة</label>
            </div>
            {scope === "some" && (
              <div className="employee-checklist">
                {employees.map((e) => (
                  <label key={e.id} className="checkbox-field"><input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleSelected(e.id)} /> {e.name}</label>
                ))}
              </div>
            )}
            <button className="btn-primary" onClick={createRun}>إنشاء كشف الرواتب</button>
          </>
        )}

        {run && (
          <div className="form-btn-group">
            {run.status === "draft" && (
              <button className="btn-primary" onClick={doPost} disabled={rows.length === 0}>ترحيل كشف الرواتب</button>
            )}
            {run.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostOpen(true)}>فك الترحيل</button>}
            <button className="icon-btn" title="طباعة كشف الرواتب" onClick={() => setPrinting(true)}><Icon.Printer /></button>
            <span className="status-badge">{run.status === "posted" ? "مرحّل" : "مسودة"}</span>
          </div>
        )}
        {error && <p className="balance-bad">{error}</p>}
      </div>

      {run && (
        <div className="panel">
          <div className="lines-table-wrap">
            <table className="lines-table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  {ROW_FIELDS.map(([f, label]) => <th key={f}>{label}</th>)}
                  <th>الصافي</th>
                  {run.status === "draft" && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td>{r.employeeName}{r.overridden && " *"}</td>
                    {ROW_FIELDS.map(([f]) => (
                      <td key={f} className="num">
                        {editingRowId === r.employeeId
                          ? <input type="number" className="amount-input" value={editForm[f]} onChange={(e) => setEditForm({ ...editForm, [f]: e.target.value })} />
                          : fmt(r[f])}
                      </td>
                    ))}
                    <td className="num strong">{fmt(r.net)}</td>
                    {run.status === "draft" && (
                      <td className="row-actions">
                        {editingRowId === r.employeeId ? (
                          <>
                            <button className="btn-ghost" onClick={saveRowEdit}>حفظ</button>
                            <button className="btn-ghost" onClick={() => setEditingRowId(null)}>إلغاء</button>
                          </>
                        ) : (
                          <>
                            <button className="btn-ghost" onClick={() => startEditRow(r)}>تعديل</button>
                            {r.overridden && <button className="btn-ghost" onClick={() => clearOverride(r.employeeId)}>استرجاع</button>}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="empty" colSpan={ROW_FIELDS.length + 3}>لا يوجد موظفون في هذا الكشف.</td></tr>}
              </tbody>
              {totals && (
                <tfoot>
                  <tr>
                    <td className="foot-label">الإجمالي</td>
                    {ROW_FIELDS.map(([f]) => <td key={f} className="num">{fmt(totals[f])}</td>)}
                    <td className="num strong">{fmt(totals.net)}</td>
                    {run.status === "draft" && <td></td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {run && <AttachmentsPanel entityType="payroll_run" entityId={run.id} />}

      {unpostOpen && <UnpostModal title="فك ترحيل كشف الرواتب" onCancel={() => setUnpostOpen(false)} onConfirm={doUnpost} />}

      {printing && run && (
        <PayrollPrintModal
          run={run}
          rows={rows}
          totals={totals}
          month={mf.applied.month}
          company={companies?.find((c) => c.id === companyId)}
          autoPrint
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
