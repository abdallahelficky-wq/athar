import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listEmployees } from "../../api/employees";
import { listHrActions, createHrActionBatch, deleteHrAction } from "../../api/hrActions";
import { listAdjustableComponents } from "../../api/payrollSettings";
import { fmt } from "../../legacy/constants";
import { useDeferredFilters } from "../shared/useDeferredFilters";
import { currencyLabel } from "../../shared/countries";

/** "الوحدة" هنا فقط لعرض تسمية مناسبة لحقل القيمة (أيام غياب مقابل مبلغ) — منسوخة من اسم البند،
 * وليست حقلاً من بنية payrollComponent نفسها (adjustmentUnitBasis يُعالَج بالكامل في الباك-إند). */
const isDaysComponent = (name) => name?.includes("غياب");

export default function ActionsTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [employees, setEmployees] = useState([]);
  const [actions, setActions] = useState([]);
  const [components, setComponents] = useState([]);
  const [error, setError] = useState("");

  const [componentId, setComponentId] = useState("");
  const mf = useDeferredFilters({ month: "2026-07" });
  const [scope, setScope] = useState("single");
  const [employeeId, setEmployeeId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listEmployees(companyId).then((es) => { setEmployees(es); if (es[0]) setEmployeeId((v) => v || es[0].id); });
    listAdjustableComponents(companyId).then((cs) => { setComponents(cs); if (cs[0]) setComponentId((v) => v || cs[0].componentId); });
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    listHrActions(companyId, mf.applied.month).then(setActions).catch((e) => setError(e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [companyId, mf.applied]);

  const componentDef = components.find((c) => c.componentId === componentId);
  const targetIds = scope === "all" ? employees.map((e) => e.id) : scope === "some" ? selectedIds : (employeeId ? [employeeId] : []);
  const toggleSelected = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    if (targetIds.length === 0 || !componentId) return;
    if (!Number(value)) return;
    try {
      await createHrActionBatch({ employeeIds: targetIds, month: mf.applied.month, componentId, value: Number(value || 0), note });
      setValue(""); setNote("");
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (a) => {
    try {
      await deleteHrAction(a.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>{t("hr.actions.actionType")}<select value={componentId} onChange={(e) => setComponentId(e.target.value)}>{components.map((c) => <option key={c.componentId} value={c.componentId}>{c.name}</option>)}</select></label>
          <form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); mf.apply(); }}>
            <label>{t("hr.actions.month")}<input type="month" value={mf.draft.month} onChange={(e) => mf.setField("month", e.target.value)} /></label>
            <button type="submit" className="btn-ghost" style={{ alignSelf: "end" }}>{t("hr.actions.showResults")}</button>
          </form>
          <label>{isDaysComponent(componentDef?.name) ? t("hr.actions.valueDays") : t("hr.actions.valueAmount", { currency })}<input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></label>
          <label className="memo-field">{t("hr.actions.note")}<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>

        <div className="scope-row">
          <label className="scope-option"><input type="radio" checked={scope === "single"} onChange={() => setScope("single")} /> {t("hr.actions.scopeSingle")}</label>
          <label className="scope-option"><input type="radio" checked={scope === "some"} onChange={() => setScope("some")} /> {t("hr.actions.scopeSome")}</label>
          <label className="scope-option"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> {t("hr.actions.scopeAll")}</label>
        </div>

        {scope === "single" && (
          <div className="form-grid"><label>{t("hr.actions.employee")}<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div>
        )}
        {scope === "some" && (
          <div className="employee-checklist">
            {employees.map((e) => (
              <label key={e.id} className="checkbox-field"><input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleSelected(e.id)} /> {e.name}</label>
            ))}
          </div>
        )}
        {scope === "all" && <p className="note">{t("hr.actions.allNote", { count: employees.length })}</p>}

        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={targetIds.length === 0 || !componentId}>{t("hr.actions.saveBtn", { count: targetIds.length })}</button>
      </div>

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>{t("hr.actions.table.employee")}</th><th>{t("hr.actions.table.action")}</th><th>{t("hr.actions.table.value")}</th><th>{t("hr.actions.table.note")}</th><th></th></tr></thead>
          <tbody>
            {actions.map((a) => {
              const def = components.find((c) => c.componentId === a.componentId || c.componentId === `legacy:${a.actionType}`);
              return (
                <tr key={a.id}>
                  <td>{a.employee?.name}</td><td>{def?.name || a.actionType}</td>
                  <td className="num">{isDaysComponent(def?.name) ? `${a.value} ${t("hr.actions.days")}` : fmt(a.value)}</td>
                  <td>{a.note || "—"}</td>
                  <td><button className="btn-ghost" onClick={() => remove(a)}>{t("common.delete")}</button></td>
                </tr>
              );
            })}
            {actions.length === 0 && <tr><td className="empty" colSpan={5}>{t("hr.actions.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
