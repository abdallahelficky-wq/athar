import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listEmployees, createEmployee, updateEmployee } from "../../api/employees";
import { listCostCenters, createCostCenter } from "../../api/costCenters";
import EmployeePortalAccessPanel from "../hr/EmployeePortalAccessPanel";

/**
 * إعداد عامل محطة من داخل موديول المحطات نفسه، بلا المرور بشاشات الموارد البشرية: اختيار موظف قائم أو
 * إنشاء موظف جديد، إسناده لمحطة (مركز تكلفة للشركة)، ثم ضبط دخوله لبوابة الجوال (رقم + PIN من 6 أرقام).
 * لا منطق دخول هنا إطلاقاً: قسم الدخول هو EmployeePortalAccessPanel نفسه (نفس المكوّن ونفس
 * /employees/:id/portal-access) — قاعدة الـ 6 أرقام والقفل وإخفاء تجزئة PIN تبقى في مكان واحد.
 * كل الصلاحيات يفرضها الخادم على نفس المسارات القائمة (إنشاء/تعديل موظف، مراكز التكلفة، الدخول للبوابة).
 */
export default function StationWorkersTab({ companyId }) {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState([]);
  const [stations, setStations] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [newStationName, setNewStationName] = useState("");
  const [addingStation, setAddingStation] = useState(false);

  const [mode, setMode] = useState("existing");
  const [pickedEmployeeId, setPickedEmployeeId] = useState("");
  const [newWorker, setNewWorker] = useState({ name: "", basicSalary: "", hireDate: new Date().toISOString().slice(0, 10) });
  const [stationId, setStationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [worker, setWorker] = useState(null); // الموظف الذي أُسنِد للتو — يظهر تحته قسم الدخول للبوابة

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [emps, centers] = await Promise.all([listEmployees(companyId), listCostCenters()]);
      setEmployees(emps);
      // المحطة = مركز تكلفة تابع لهذه الشركة تحديداً (الخادم يرفض إسناد موظف لمركز شركة أخرى)
      setStations(centers.filter((c) => c.companyId === companyId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setWorker(null); load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stationName = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s.name])), [stations]);
  const assigned = employees.filter((e) => e.assignedCostCenterId && stationName[e.assignedCostCenterId]);

  const addStation = async () => {
    if (newStationName.trim().length < 2) { setError(t("stationWorkers.errStationName")); return; }
    setAddingStation(true);
    setError("");
    try {
      const created = await createCostCenter({ name: newStationName.trim(), companyId });
      setStations((prev) => [...prev, created]);
      setStationId(created.id);
      setNewStationName("");
    } catch (e) {
      setError(e.message);
    } finally {
      setAddingStation(false);
    }
  };

  const assign = async () => {
    setError("");
    if (!stationId) { setError(t("stationWorkers.errStation")); return; }
    setSaving(true);
    try {
      let saved;
      if (mode === "new") {
        if (newWorker.name.trim().length < 2) throw new Error(t("stationWorkers.errName"));
        if (!(Number(newWorker.basicSalary) > 0)) throw new Error(t("stationWorkers.errSalary"));
        saved = await createEmployee({
          companyId,
          name: newWorker.name.trim(),
          basicSalary: Number(newWorker.basicSalary),
          hireDate: newWorker.hireDate,
          jobTitle: t("stationWorkers.defaultJobTitle"),
          assignedCostCenterId: stationId,
        });
      } else {
        if (!pickedEmployeeId) throw new Error(t("stationWorkers.errPick"));
        saved = await updateEmployee(pickedEmployeeId, { assignedCostCenterId: stationId });
      }
      setWorker(saved);
      setNewWorker({ name: "", basicSalary: "", hireDate: new Date().toISOString().slice(0, 10) });
      setPickedEmployeeId("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setUp = (employee) => {
    setWorker(employee);
    setStationId(employee.assignedCostCenterId || "");
  };

  if (loading) return <div className="panel"><p className="note">…</p></div>;

  return (
    <div className="station-workers">
      {error && <p className="balance-bad">{error}</p>}

      <div className="panel form-panel">
        <h3>{t("stationWorkers.stationsTitle")}</h3>
        <p className="note">{t("stationWorkers.stationsNote")}</p>
        {stations.length === 0 ? (
          <p className="note">{t("stationWorkers.noStations")}</p>
        ) : (
          <div className="station-chips">
            {stations.map((s) => <span key={s.id} className="status-badge">{s.name}</span>)}
          </div>
        )}
        <div className="form-btn-group">
          <input type="text" value={newStationName} onChange={(e) => setNewStationName(e.target.value)} placeholder={t("stationWorkers.newStationPlaceholder")} />
          <button className="btn-ghost" onClick={addStation} disabled={addingStation}>{t("stationWorkers.addStation")}</button>
        </div>
      </div>

      <div className="panel form-panel">
        <h3>{t("stationWorkers.assignTitle")}</h3>
        <div className="station-worker-mode" role="radiogroup">
          <label><input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> {t("stationWorkers.modeExisting")}</label>
          <label><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> {t("stationWorkers.modeNew")}</label>
        </div>
        <div className="form-grid">
          {mode === "existing" ? (
            <label>{t("stationWorkers.employee")}
              <select value={pickedEmployeeId} onChange={(e) => setPickedEmployeeId(e.target.value)}>
                <option value="">{t("stationWorkers.pickEmployee")}</option>
                {employees.filter((e) => e.status === "active").map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.assignedCostCenterId && stationName[e.assignedCostCenterId] ? ` — ${stationName[e.assignedCostCenterId]}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>{t("stationWorkers.name")}<input type="text" value={newWorker.name} onChange={(e) => setNewWorker({ ...newWorker, name: e.target.value })} /></label>
              <label>{t("stationWorkers.basicSalary")}<input type="number" min="0" value={newWorker.basicSalary} onChange={(e) => setNewWorker({ ...newWorker, basicSalary: e.target.value })} /></label>
              <label>{t("stationWorkers.hireDate")}<input type="date" value={newWorker.hireDate} onChange={(e) => setNewWorker({ ...newWorker, hireDate: e.target.value })} /></label>
            </>
          )}
          <label>{t("stationWorkers.station")}
            <select value={stationId} onChange={(e) => setStationId(e.target.value)} disabled={stations.length === 0}>
              <option value="">{t("stationWorkers.pickStation")}</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <button className="btn-primary" onClick={assign} disabled={saving || stations.length === 0}>
          {saving ? t("stationWorkers.saving") : t("stationWorkers.assignBtn")}
        </button>

        {worker && (
          <div className="station-worker-portal">
            <p className="note">{t("stationWorkers.assignedNote", { name: worker.name, station: stationName[worker.assignedCostCenterId] || "—" })}</p>
            <EmployeePortalAccessPanel
              key={worker.id}
              employeeId={worker.id}
              defaultPhone={worker.phone}
              employeeStatus={worker.status}
              onSaved={(access) => setEmployees((prev) => prev.map((e) => (e.id === access.id ? { ...e, phone: access.phone } : e)))}
            />
          </div>
        )}
      </div>

      <div className="panel">
        <h3>{t("stationWorkers.listTitle")}</h3>
        {assigned.length === 0 ? (
          <p className="note">{t("stationWorkers.noWorkers")}</p>
        ) : (
          <div className="lines-table-wrap"><table className="lines-table">
            <thead><tr><th>{t("stationWorkers.employee")}</th><th>{t("stationWorkers.station")}</th><th>{t("stationWorkers.phone")}</th><th></th></tr></thead>
            <tbody>
              {assigned.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{stationName[e.assignedCostCenterId]}</td>
                  <td dir="ltr">{e.phone || "—"}</td>
                  <td><button className="btn-ghost" onClick={() => setUp(e)}>{t("stationWorkers.setUpBtn")}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
