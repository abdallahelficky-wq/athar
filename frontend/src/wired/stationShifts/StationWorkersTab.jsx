import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCostCenters, createCostCenter } from "../../api/costCenters";
import * as api from "../../api/stationUsers";

/**
 * مستخدمو تطبيق المحطات — عمّال ومشرفون مستقلون عن شئون الموظفين (لا راتب ولا رواتب). من هنا: إضافة، تعديل (الاسم، الدور،
 * المحطة، الجوال)، إعادة تعيين الرمز (يفكّ القفل)، إيقاف/تفعيل الدخول، أرشفة واسترجاع، وحذف من لا ورديات له. العامل يفتح
 * ورديات محطته ويقفلها؛ المشرف يرى كل محطات الشركة حيّة ويراسل عمّالها. الصلاحيات يفرضها الخادم (/station-users).
 */
const EMPTY = { name: "", role: "worker", costCenterId: "", phone: "", pin: "" };

export default function StationWorkersTab({ companyId }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [stations, setStations] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newStationName, setNewStationName] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // id المستخدم قيد التعديل
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState("active");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [list, centers] = await Promise.all([api.listStationUsers(companyId), listCostCenters()]);
      setUsers(list);
      setStations(centers.filter((c) => c.companyId === companyId));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { setEditing(null); load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stationName = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s.name])), [stations]);
  const shown = users.filter((u) => (filter === "archived" ? u.archivedAt : !u.archivedAt));

  const run = async (fn, okMsg) => {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); if (okMsg) setNotice(okMsg); await load(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };

  const addStation = () => {
    if (newStationName.trim().length < 2) { setError(t("stationWorkers.errStationName")); return; }
    run(async () => { await createCostCenter({ name: newStationName.trim(), companyId }); setNewStationName(""); });
  };

  const create = () => {
    if (!/^\d{6}$/.test(form.pin)) { setError(t("stationWorkers.errPin")); return; }
    run(async () => {
      await api.createStationUser({ companyId, name: form.name.trim(), role: form.role, costCenterId: form.role === "worker" ? form.costCenterId || null : form.costCenterId || null, phone: form.phone.trim(), pin: form.pin });
      setForm(EMPTY);
    }, t("stationWorkers.created"));
  };

  const startEdit = (u) => { setEditing(u.id); setEdit({ name: u.name, role: u.role, costCenterId: u.costCenterId || "", phone: u.phone || "", pin: "" }); };
  const saveEdit = async (u) => {
    if (edit.pin && !/^\d{6}$/.test(edit.pin)) { setError(t("stationWorkers.errPin")); return; }
    const ok = await run(() => api.updateStationUser(u.id, {
      name: edit.name.trim(), role: edit.role, costCenterId: edit.costCenterId || null, phone: edit.phone.trim(), ...(edit.pin ? { pin: edit.pin } : {}),
    }), t("stationWorkers.saved"));
    if (ok) setEditing(null);
  };
  const remove = (u) => {
    if (!window.confirm(t("stationWorkers.confirmDelete", { name: u.name }))) return;
    run(() => api.deleteStationUser(u.id), t("stationWorkers.deleted"));
  };

  if (loading) return <div className="panel"><p className="note">…</p></div>;

  const stationSelect = (value, onChange, role) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{role === "supervisor" ? t("stationWorkers.allStations") : t("stationWorkers.pickStation")}</option>
      {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );

  return (
    <div className="station-workers">
      {error && <p className="balance-bad">{error}</p>}
      {notice && <p className="note" style={{ color: "var(--athar-success, #2b8a3e)" }}>{notice}</p>}

      <div className="panel form-panel">
        <h3>{t("stationWorkers.stationsTitle")}</h3>
        <p className="note">{t("stationWorkers.stationsNote")}</p>
        {stations.length === 0 ? <p className="note">{t("stationWorkers.noStations")}</p> : (
          <div className="station-chips">{stations.map((s) => <span key={s.id} className="status-badge">{s.name}</span>)}</div>
        )}
        <div className="form-btn-group">
          <input type="text" value={newStationName} onChange={(e) => setNewStationName(e.target.value)} placeholder={t("stationWorkers.newStationPlaceholder")} />
          <button className="btn-ghost" onClick={addStation} disabled={busy}>{t("stationWorkers.addStation")}</button>
        </div>
      </div>

      <div className="panel form-panel">
        <h3>{t("stationWorkers.addUserTitle")}</h3>
        <p className="note">{t("stationWorkers.usersNote")}</p>
        <div className="form-grid">
          <label>{t("stationWorkers.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("stationWorkers.role")}
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="worker">{t("stationWorkers.roles.worker")}</option>
              <option value="supervisor">{t("stationWorkers.roles.supervisor")}</option>
            </select>
          </label>
          <label>{t("stationWorkers.station")}{stationSelect(form.costCenterId, (v) => setForm({ ...form, costCenterId: v }), form.role)}</label>
          <label>{t("stationWorkers.phone")}<input type="tel" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>{t("stationWorkers.pin")}<input type="password" inputMode="numeric" maxLength={6} dir="ltr" autoComplete="new-password" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })} /></label>
        </div>
        <button className="btn-primary" onClick={create} disabled={busy}>{t("stationWorkers.addUserBtn")}</button>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{t("stationWorkers.usersTitle")}</h3>
          <div className="station-worker-mode" role="radiogroup">
            <label><input type="radio" checked={filter === "active"} onChange={() => setFilter("active")} /> {t("stationWorkers.filterActive", { count: users.filter((u) => !u.archivedAt).length })}</label>
            <label><input type="radio" checked={filter === "archived"} onChange={() => setFilter("archived")} /> {t("stationWorkers.filterArchived", { count: users.filter((u) => u.archivedAt).length })}</label>
          </div>
        </div>
        {shown.length === 0 ? <p className="note">{t("stationWorkers.noUsers")}</p> : (
          <div className="lines-table-wrap"><table className="lines-table">
            <thead><tr>
              <th>{t("stationWorkers.name")}</th><th>{t("stationWorkers.role")}</th><th>{t("stationWorkers.station")}</th><th>{t("stationWorkers.phone")}</th>
              <th>{t("stationWorkers.login")}</th><th>{t("stationWorkers.shifts")}</th><th>{t("stationWorkers.actions")}</th>
            </tr></thead>
            <tbody>
              {shown.map((u) => editing === u.id ? (
                <tr key={u.id}>
                  <td><input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                  <td>
                    <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                      <option value="worker">{t("stationWorkers.roles.worker")}</option>
                      <option value="supervisor">{t("stationWorkers.roles.supervisor")}</option>
                    </select>
                  </td>
                  <td>{stationSelect(edit.costCenterId, (v) => setEdit({ ...edit, costCenterId: v }), edit.role)}</td>
                  <td><input type="tel" dir="ltr" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></td>
                  <td><input type="password" inputMode="numeric" maxLength={6} dir="ltr" autoComplete="new-password" placeholder={t("stationWorkers.newPin")} value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, "") })} /></td>
                  <td>{u.shiftsCount}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn-primary" disabled={busy} onClick={() => saveEdit(u)}>{t("stationWorkers.save")}</button>{" "}
                    <button className="btn-ghost" disabled={busy} onClick={() => setEditing(null)}>{t("stationWorkers.cancel")}</button>
                  </td>
                </tr>
              ) : (
                <tr key={u.id}>
                  <td>{u.name}{u.hasOpenShift && <span className="status-badge" style={{ marginInlineStart: 6 }}>{t("stationWorkers.onShift")}</span>}</td>
                  <td>{t(`stationWorkers.roles.${u.role}`)}</td>
                  <td>{u.costCenterId ? stationName[u.costCenterId] || u.stationName : (u.role === "supervisor" ? t("stationWorkers.allStations") : "—")}</td>
                  <td dir="ltr">{u.phone || "—"}</td>
                  <td>{u.archivedAt ? t("stationWorkers.archived") : !u.hasPin ? t("stationWorkers.noPin") : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? t("stationWorkers.locked") : u.active ? t("stationWorkers.loginOn") : t("stationWorkers.loginOff")}</td>
                  <td>{u.shiftsCount}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {u.archivedAt ? (
                      <button className="btn-ghost" disabled={busy} onClick={() => run(() => api.restoreStationUser(u.id), t("stationWorkers.restored"))}>{t("stationWorkers.restore")}</button>
                    ) : (
                      <>
                        <button className="btn-ghost" disabled={busy} onClick={() => startEdit(u)}>{t("stationWorkers.edit")}</button>{" "}
                        <button className="btn-ghost" disabled={busy} onClick={() => run(() => api.updateStationUser(u.id, { active: !u.active }))}>{u.active ? t("stationWorkers.disableLogin") : t("stationWorkers.enableLogin")}</button>{" "}
                        <button className="btn-ghost" disabled={busy} onClick={() => run(() => api.archiveStationUser(u.id), t("stationWorkers.archivedMsg"))}>{t("stationWorkers.archive")}</button>
                      </>
                    )}{" "}
                    {u.shiftsCount === 0 && <button className="btn-ghost" disabled={busy} onClick={() => remove(u)}>{t("stationWorkers.delete")}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
