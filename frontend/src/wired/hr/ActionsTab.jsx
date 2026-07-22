import React, { useEffect, useState } from "react";
import { listEmployees } from "../../api/employees";
import { listHrActions, createHrActionBatch, deleteHrAction } from "../../api/hrActions";
import { fmt } from "../../legacy/constants";

const ACTION_TYPES = [
  { id: "absence", label: "غياب", unit: "days" },
  { id: "overtime", label: "عمل إضافي (بدل إضافي)", unit: "amount" },
  { id: "bonus", label: "مكافأة / حافز", unit: "amount" },
  { id: "other_addition", label: "إضافات أخرى", unit: "amount" },
  { id: "advance", label: "سلفة", unit: "amount" },
  { id: "violation", label: "مخالفة (مرورية/تشغيلية)", unit: "amount" },
  { id: "penalty", label: "جزاء / عقوبة تأديبية (المادة 91)", unit: "amount" },
  { id: "other_deduction", label: "خصومات أخرى", unit: "amount" },
  { id: "warning", label: "إنذار / تنبيه (بدون أثر مالي)", unit: "none" },
];
const ACTION_TYPE_MAP = Object.fromEntries(ACTION_TYPES.map((a) => [a.id, a]));

export default function ActionsTab({ companyId }) {
  const [employees, setEmployees] = useState([]);
  const [actions, setActions] = useState([]);
  const [error, setError] = useState("");

  const [actionType, setActionType] = useState(ACTION_TYPES[0].id);
  const [month, setMonth] = useState("2026-07");
  const [scope, setScope] = useState("single");
  const [employeeId, setEmployeeId] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listEmployees(companyId).then((es) => { setEmployees(es); if (es[0]) setEmployeeId((v) => v || es[0].id); });
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    listHrActions(companyId, month).then(setActions).catch((e) => setError(e.message));
  };
  useEffect(reload, [companyId, month]);

  const actionDef = ACTION_TYPE_MAP[actionType];
  const targetIds = scope === "all" ? employees.map((e) => e.id) : scope === "some" ? selectedIds : (employeeId ? [employeeId] : []);
  const toggleSelected = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    if (targetIds.length === 0) return;
    if (actionDef.unit !== "none" && !Number(value)) return;
    try {
      await createHrActionBatch({ employeeIds: targetIds, month, actionType, value: Number(value || 0), note });
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

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>نوع الإجراء<select value={actionType} onChange={(e) => setActionType(e.target.value)}>{ACTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <label>شهر الرواتب<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          {actionDef.unit !== "none" && (
            <label>{actionDef.unit === "days" ? "عدد الأيام" : "القيمة (ر.س)"}<input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></label>
          )}
          <label className="memo-field">ملاحظة<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>

        <div className="scope-row">
          <label className="scope-option"><input type="radio" checked={scope === "single"} onChange={() => setScope("single")} /> موظف واحد</label>
          <label className="scope-option"><input type="radio" checked={scope === "some"} onChange={() => setScope("some")} /> مجموعة محددة</label>
          <label className="scope-option"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> كل الموظفين</label>
        </div>

        {scope === "single" && (
          <div className="form-grid"><label>الموظف<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div>
        )}
        {scope === "some" && (
          <div className="employee-checklist">
            {employees.map((e) => (
              <label key={e.id} className="checkbox-field"><input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleSelected(e.id)} /> {e.name}</label>
            ))}
          </div>
        )}
        {scope === "all" && <p className="note">سيُطبَّق هذا الإجراء على كل موظفي هذه الشركة ({employees.length} موظف).</p>}

        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={targetIds.length === 0}>حفظ الإجراء ({targetIds.length} موظف)</button>
      </div>

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الموظف</th><th>الإجراء</th><th>القيمة</th><th>ملاحظة</th><th></th></tr></thead>
          <tbody>
            {actions.map((a) => {
              const def = ACTION_TYPE_MAP[a.actionType];
              return (
                <tr key={a.id}>
                  <td>{a.employee?.name}</td><td>{def?.label}</td>
                  <td className="num">{def?.unit === "none" ? "—" : def?.unit === "days" ? `${a.value} يوم` : fmt(a.value)}</td>
                  <td>{a.note || "—"}</td>
                  <td><button className="btn-ghost" onClick={() => remove(a)}>حذف</button></td>
                </tr>
              );
            })}
            {actions.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد إجراءات مسجّلة لهذا الشهر بعد.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
