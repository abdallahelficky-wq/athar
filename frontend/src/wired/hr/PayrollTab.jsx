import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listEmployees } from "../../api/employees";
import {
  listPayrollRuns, createPayrollRun, getPayrollRunRows, updatePayrollRunEmployees,
  setPayrollRowOverride, clearPayrollRowOverride, postPayrollRun, unpostPayrollRun,
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

export default function PayrollTab({ companyId, companies }) {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState([]);
  const mf = useDeferredFilters({ month: "2026-07" });
  const [scope, setScope] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [run, setRun] = useState(null);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [columns, setColumns] = useState([]);
  const [payslipColumns, setPayslipColumns] = useState([]);
  const [error, setError] = useState("");
  const [unpostOpen, setUnpostOpen] = useState(false);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    listEmployees(companyId).then(setEmployees);
    getPayrollSettings(companyId).then((s) => setPayslipColumns(s.payslipColumns || []));
  }, [companyId]);

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
    } else {
      setRows([]); setTotals(null); setColumns([]);
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

  const startEditRow = (row) => { setEditingRowId(row.employeeId); setEditForm({ ...row.componentValues }); };
  const saveRowEdit = async () => {
    try {
      const override = {};
      columns.forEach((col) => { override[col.id] = Number(editForm[col.id] || 0); });
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

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); mf.apply(); }}>
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
            {run.status === "draft" && (
              <button className="btn-primary" onClick={doPost} disabled={rows.length === 0}>{t("hr.payroll.postRun")}</button>
            )}
            {run.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostOpen(true)}>{t("hr.payroll.unpost")}</button>}
            <button className="icon-btn" title={t("hr.payroll.printTitle")} onClick={() => setPrinting(true)}><Icon.Printer /></button>
            <span className="status-badge">{run.status === "posted" ? t("hr.payroll.statusPosted") : t("hr.payroll.statusDraft")}</span>
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
                        {editingRowId === r.employeeId
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

      {run && <AttachmentsPanel entityType="payroll_run" entityId={run.id} />}

      {unpostOpen && <UnpostModal title={t("hr.payroll.unpostTitle")} onCancel={() => setUnpostOpen(false)} onConfirm={doUnpost} />}

      {printing && run && (
        <PayrollPrintModal
          run={run}
          rows={rows}
          totals={totals}
          columns={displayColumns}
          month={mf.applied.month}
          company={companies?.find((c) => c.id === companyId)}
          autoPrint
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
