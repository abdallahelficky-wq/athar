import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listPositions,
  listAssignableUsers,
  listPlatformActions,
  createPosition,
  updatePosition,
  deletePosition,
  assignMember,
  removeMember,
  updatePositionActionPermission,
  listUserOverrides,
  upsertUserOverride,
  deleteUserOverride,
} from "../api/positions";
import { useToast, ToastHost } from "./shared/Toast";

const ACTION_LEVELS = ["none", "read", "edit", "approve", "full"];

/**
 * شاشة إدارة المناصب وصلاحياتها — مقصورة على مالك الشركة فقط (الخادم يرفض أي طلب من غيره عبر
 * requireTenantOwner، بصرف النظر عمّا تعرضه هذه الواجهة). قائمة الوحدات/الإجراءات (platformActions
 * أدناه) تُقرَأ من الخادم (PLATFORM_ACTIONS في lib/platformActions.ts) بدل كتابة وحدة واحدة صراحة
 * هنا — أي وحدة جديدة تُهاجَر للنظام الترتيبي تظهر تلقائياً في مُحدِّد الوحدة بلا أي تعديل في هذا
 * الملف.
 */
export default function PositionsTab() {
  const { t, i18n } = useTranslation();
  const [positions, setPositions] = useState([]);
  const [users, setUsers] = useState([]);
  const [platformActions, setPlatformActions] = useState({});
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();
  const [name, setName] = useState("");
  const [allowUnpost, setAllowUnpost] = useState(false);
  const [allowPosDeferredSale, setAllowPosDeferredSale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memberSelections, setMemberSelections] = useState({});
  const [moduleSelections, setModuleSelections] = useState({});
  const [overrides, setOverrides] = useState([]);
  const [overrideUserId, setOverrideUserId] = useState("");
  const [overrideModuleId, setOverrideModuleId] = useState("");
  const [overrideActionId, setOverrideActionId] = useState("");
  const [overrideLevel, setOverrideLevel] = useState("");

  const moduleIds = Object.keys(platformActions);
  const actionLabel = (action) => (i18n.language === "en" ? action.label.en : action.label.ar);
  const moduleActions = (moduleId) => platformActions[moduleId] || [];
  const selectedModuleFor = (position) => moduleSelections[position.id] || moduleIds[0] || "";

  const reload = () => {
    setLoading(true);
    Promise.all([listPositions(), listAssignableUsers(), listUserOverrides(), listPlatformActions()])
      .then(([p, u, o, actions]) => {
        setPositions(p);
        setUsers(u);
        setOverrides(o);
        setPlatformActions(actions);
      })
      .catch((e) => notify(e.message, "error"))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createPosition({ name: name.trim(), allowUnpost, allowPosDeferredSale });
      setName("");
      setAllowUnpost(false);
      setAllowPosDeferredSale(false);
      reload();
      notify(t("settings.positions.notifyCreated"), "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleUnpost = async (position) => {
    try {
      await updatePosition(position.id, { allowUnpost: !position.allowUnpost });
      reload();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const togglePosDeferredSale = async (position) => {
    try {
      await updatePosition(position.id, { allowPosDeferredSale: !position.allowPosDeferredSale });
      reload();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const remove = async (position) => {
    if (!window.confirm(t("settings.positions.confirmDelete", { name: position.name }))) return;
    try {
      await deletePosition(position.id);
      reload();
      notify(t("settings.positions.notifyDeleted"), "success");
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const addMember = async (position) => {
    const userId = memberSelections[position.id];
    if (!userId) return;
    try {
      await assignMember(position.id, userId);
      setMemberSelections((prev) => ({ ...prev, [position.id]: "" }));
      reload();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const removeMemberFrom = async (position, userId) => {
    try {
      await removeMember(position.id, userId);
      reload();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const unassignedUsers = (position) => users.filter((u) => u.positionId !== position.id);

  const changeLevel = async (position, moduleId, actionId, level) => {
    try {
      await updatePositionActionPermission(position.id, { moduleId, actionId, level });
      reload();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const addOverride = async () => {
    if (!overrideUserId || !overrideModuleId || !overrideActionId || !overrideLevel) return;
    try {
      await upsertUserOverride({
        userId: overrideUserId,
        moduleId: overrideModuleId,
        actionId: overrideActionId,
        level: overrideLevel,
      });
      setOverrideUserId("");
      setOverrideModuleId("");
      setOverrideActionId("");
      setOverrideLevel("");
      reload();
      notify(t("settings.positions.notifyOverrideAdded"), "success");
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const removeOverride = async (override) => {
    try {
      await deleteUserOverride(override.id);
      reload();
      notify(t("settings.positions.notifyOverrideRemoved"), "success");
    } catch (err) {
      notify(err.message, "error");
    }
  };

  if (loading) return <p className="empty">{t("common.loading")}</p>;

  return (
    <div>
      <ToastHost toast={toast} onDismiss={dismiss} />

      <div className="panel form-panel">
        <div className="form-grid">
          <label className="memo-field">
            {t("settings.positions.nameLabel")}
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.positions.namePlaceholder")}
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={allowUnpost} onChange={(e) => setAllowUnpost(e.target.checked)} />
            {t("settings.positions.allowUnpostLabel")}
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={allowPosDeferredSale}
              onChange={(e) => setAllowPosDeferredSale(e.target.checked)}
            />
            {t("settings.positions.allowPosDeferredSaleLabel")}
          </label>
        </div>
        <button className="btn-primary" onClick={create} disabled={saving || !name.trim()}>
          {t("common.add")}
        </button>
      </div>

      {positions.length === 0 && <p className="empty">{t("settings.positions.empty")}</p>}

      {positions.map((position) => (
        <div key={position.id} className="panel">
          <div className="form-grid">
            <h3>{position.name}</h3>
            <button className="btn-ghost" onClick={() => remove(position)}>
              {t("common.delete")}
            </button>
          </div>

          <label className="checkbox-label">
            <input type="checkbox" checked={position.allowUnpost} onChange={() => toggleUnpost(position)} />
            {t("settings.positions.allowUnpostLabel")}
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={position.allowPosDeferredSale}
              onChange={() => togglePosDeferredSale(position)}
            />
            {t("settings.positions.allowPosDeferredSaleLabel")}
          </label>

          <p className="note">{t("settings.positions.permissionsTitle")}</p>
          <div className="form-grid">
            <select
              value={selectedModuleFor(position)}
              onChange={(e) => setModuleSelections((prev) => ({ ...prev, [position.id]: e.target.value }))}
            >
              {moduleIds.map((moduleId) => (
                <option key={moduleId} value={moduleId}>
                  {moduleId}
                </option>
              ))}
            </select>
          </div>
          <table className="ledger-table">
            <tbody>
              {moduleActions(selectedModuleFor(position)).map((action) => (
                <tr key={action.id}>
                  <td>{actionLabel(action)}</td>
                  <td>
                    <select
                      value={position.actionLevels?.[selectedModuleFor(position)]?.[action.id] || "none"}
                      onChange={(e) => changeLevel(position, selectedModuleFor(position), action.id, e.target.value)}
                    >
                      {ACTION_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {t(`settings.positions.levels.${level}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="tag-cloud">
            {position.members.map((m) => (
              <span key={m.id} className="tag-chip">
                {m.name} ({m.email})
                <button onClick={() => removeMemberFrom(position, m.id)}>✕</button>
              </span>
            ))}
          </div>
          {position.members.length === 0 && <p className="note">{t("settings.positions.noMembers")}</p>}

          <div className="form-grid">
            <select
              value={memberSelections[position.id] || ""}
              onChange={(e) => setMemberSelections((prev) => ({ ...prev, [position.id]: e.target.value }))}
            >
              <option value="">{t("settings.positions.chooseUser")}</option>
              {unassignedUsers(position).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
            <button className="btn-ghost" onClick={() => addMember(position)} disabled={!memberSelections[position.id]}>
              {t("settings.positions.addMember")}
            </button>
          </div>
        </div>
      ))}

      <div className="panel">
        <h3>{t("settings.positions.overridesTitle")}</h3>

        <div className="form-grid">
          <select value={overrideUserId} onChange={(e) => setOverrideUserId(e.target.value)}>
            <option value="">{t("settings.positions.chooseUser")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
          <select
            value={overrideModuleId}
            onChange={(e) => {
              setOverrideModuleId(e.target.value);
              setOverrideActionId("");
            }}
          >
            <option value="">{t("settings.positions.chooseModule")}</option>
            {moduleIds.map((moduleId) => (
              <option key={moduleId} value={moduleId}>
                {moduleId}
              </option>
            ))}
          </select>
          <select value={overrideActionId} onChange={(e) => setOverrideActionId(e.target.value)} disabled={!overrideModuleId}>
            <option value="">{t("settings.positions.chooseAction")}</option>
            {moduleActions(overrideModuleId).map((action) => (
              <option key={action.id} value={action.id}>
                {actionLabel(action)}
              </option>
            ))}
          </select>
          <select value={overrideLevel} onChange={(e) => setOverrideLevel(e.target.value)}>
            <option value="">{t("settings.positions.chooseLevel")}</option>
            {ACTION_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t(`settings.positions.levels.${level}`)}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost"
            onClick={addOverride}
            disabled={!overrideUserId || !overrideModuleId || !overrideActionId || !overrideLevel}
          >
            {t("settings.positions.addOverride")}
          </button>
        </div>

        {overrides.length === 0 && <p className="note">{t("settings.positions.overridesEmpty")}</p>}
        {overrides.length > 0 && (
          <table className="ledger-table">
            <tbody>
              {overrides.map((o) => {
                const action = moduleActions(o.moduleId).find((a) => a.id === o.actionId);
                return (
                  <tr key={o.id}>
                    <td>{o.user.name} ({o.user.email})</td>
                    <td>{o.moduleId}</td>
                    <td>{action ? actionLabel(action) : o.actionId}</td>
                    <td>{t(`settings.positions.levels.${o.level}`)}</td>
                    <td>
                      <button className="btn-ghost" onClick={() => removeOverride(o)}>
                        {t("settings.positions.removeOverride")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
