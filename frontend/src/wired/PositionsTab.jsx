import PositionMatrix from "./PositionMatrix";
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

// أسماء الوحدات المعروضة بدل معرّفاتها الداخلية (leaveRequests…) — وحدة جديدة بلا اسم هنا تظهر بمعرّفها.
const MODULE_LABELS = {
  leaveRequests: { ar: "طلبات الإجازة", en: "Leave requests" },
  stationShifts: { ar: "ورديات المحطات", en: "Station shifts" },
};

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
  const [saving, setSaving] = useState(false);
  const [memberSelections, setMemberSelections] = useState({});
  const [openId, setOpenId] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [overrideUserId, setOverrideUserId] = useState("");
  const [overrideModuleId, setOverrideModuleId] = useState("");
  const [overrideActionId, setOverrideActionId] = useState("");
  const [overrideLevel, setOverrideLevel] = useState("");

  const moduleIds = Object.keys(platformActions);
  const actionLabel = (action) => (i18n.language === "en" ? action.label.en : action.label.ar);
  const en = i18n.language === "en";
  const moduleLabel = (moduleId) => MODULE_LABELS[moduleId]?.[en ? "en" : "ar"] || moduleId;
  const moduleActions = (moduleId) => platformActions[moduleId] || [];

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
      const created = await createPosition({ name: name.trim() });
      setName("");
      if (created?.id) setOpenId(created.id);
      reload();
      notify(t("settings.positions.notifyCreated"), "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleFlag = async (position, flag) => {
    try {
      await updatePosition(position.id, { [flag]: !position[flag] });
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

  const flags = [
    ["allowUnpost", t("settings.positions.allowUnpostLabel")],
    ["allowPosDeferredSale", t("settings.positions.allowPosDeferredSaleLabel")],
    ["allowPosPriceOverride", t("settings.positions.allowPosPriceOverrideLabel")],
  ];

  return (
    <div className="positions-management">
      <ToastHost toast={toast} onDismiss={dismiss} />

      <div className="panel positions-create">
        <label className="memo-field">
          {en ? "New position" : "منصب جديد"}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
            placeholder={t("settings.positions.namePlaceholder")}
          />
        </label>
        <button className="btn-primary" onClick={create} disabled={saving || !name.trim()}>
          {t("common.add")}
        </button>
      </div>

      {positions.length === 0 && <p className="empty">{t("settings.positions.empty")}</p>}

      {positions.map((position) => {
        const open = openId === position.id;
        return (
        <div key={position.id} className={`panel position-card${open ? " is-open" : ""}`}>
          <button type="button" className="position-head" aria-expanded={open}
            onClick={() => setOpenId(open ? null : position.id)}>
            <span className="position-chevron" aria-hidden="true">{open ? "▾" : (en ? "▸" : "◂")}</span>
            <strong>{position.name}</strong>
            <span className="position-badge">
              {en ? "Members" : "الأعضاء"}: {position.members.length}
            </span>
            <span className={`position-badge${position.matrixEnabled ? " is-active" : ""}`}>
              {position.matrixEnabled ? (en ? "Matrix active" : "المصفوفة مفعّلة") : (en ? "Previous policy" : "صلاحيات سابقة")}
            </span>
          </button>

          {open && <div className="position-body">
            <section className="position-section">
              <h4>{en ? "Members" : "الأعضاء"}</h4>
              {position.members.length === 0 ? <p className="note">{t("settings.positions.noMembers")}</p> : (
                <div className="tag-cloud">
                  {position.members.map((m) => (
                    <span key={m.id} className="tag-chip">
                      {m.name} ({m.email})
                      <button aria-label={en ? `Remove ${m.name}` : `إزالة ${m.name}`} onClick={() => removeMemberFrom(position, m.id)}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="position-inline">
                <select
                  aria-label={en ? "Assign user to position" : "تعيين مستخدم للمنصب"}
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
                <button aria-label={en ? "Assign selected user" : "تعيين المستخدم المحدد"} className="btn-ghost" onClick={() => addMember(position)} disabled={!memberSelections[position.id]}>
                  {t("settings.positions.addMember")}
                </button>
              </div>
            </section>

            <PositionMatrix position={position} onSaved={(updated) => setPositions((items) => items.map((item) => item.id === updated.id ? updated : item))} />

            <section className="position-section">
              <h4>{en ? "Posting and point of sale" : "القيود ونقطة البيع"}</h4>
              {flags.map(([flag, text]) => (
                <label key={flag} className="checkbox-label">
                  <input type="checkbox" checked={!!position[flag]} onChange={() => toggleFlag(position, flag)} />
                  {text}
                </label>
              ))}
            </section>

            <section className="position-section">
              <h4>{en ? "Leave requests and station shifts" : "طلبات الإجازة وورديات المحطات"}</h4>
              <p className="note">{en ? "Each change is saved immediately." : "يُحفظ كل تغيير فور اختياره."}</p>
              {moduleIds.map((moduleId) => (
                <table key={moduleId} className="ledger-table position-levels">
                  <thead><tr><th colSpan={2}>{moduleLabel(moduleId)}</th></tr></thead>
                  <tbody>
                    {moduleActions(moduleId).map((action) => (
                      <tr key={action.id}>
                        <td>{actionLabel(action)}</td>
                        <td>
                          <select
                            aria-label={`${moduleLabel(moduleId)} — ${actionLabel(action)}`}
                            value={position.actionLevels?.[moduleId]?.[action.id] || "none"}
                            onChange={(e) => changeLevel(position, moduleId, action.id, e.target.value)}
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
              ))}
            </section>

            <div className="position-danger">
              <button className="btn-ghost" onClick={() => remove(position)}>
                {en ? "Delete position" : "حذف المنصب"}
              </button>
            </div>
          </div>}
        </div>
        );
      })}

      <div className="panel">
        <h3>{t("settings.positions.overridesTitle")}</h3>
        <p className="note">{en ? "Raises or lowers one user's level for a single leave or station action, overriding their position." : "ترفع أو تخفض مستوى مستخدم واحد في إجراء محدد من الإجازات أو المحطات، بدل ما يمنحه منصبه."}</p>

        <div className="form-grid">
          <select aria-label={en ? "User" : "المستخدم"} value={overrideUserId} onChange={(e) => setOverrideUserId(e.target.value)}>
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
                {moduleLabel(moduleId)}
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
                    <td>{moduleLabel(o.moduleId)}</td>
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
