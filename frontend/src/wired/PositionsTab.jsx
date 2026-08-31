import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listPositions,
  listAssignableUsers,
  createPosition,
  updatePosition,
  deletePosition,
  assignMember,
  removeMember,
} from "../api/positions";
import { useToast, ToastHost } from "./shared/Toast";

/**
 * المرحلة الأولى من نظام صلاحيات المناصب — شاشة صغيرة مقصورة على مالك الشركة فقط (الخادم يرفض
 * أي طلب من غيره عبر requireTenantOwner، بصرف النظر عمّا تعرضه هذه الواجهة). تغطي صلاحية واحدة
 * فقط حالياً: "فك ترحيل القيود" — راجع positions.service.ts في الخادم لبقية التفاصيل.
 */
export default function PositionsTab() {
  const { t } = useTranslation();
  const [positions, setPositions] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();
  const [name, setName] = useState("");
  const [allowUnpost, setAllowUnpost] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memberSelections, setMemberSelections] = useState({});

  const reload = () => {
    setLoading(true);
    Promise.all([listPositions(), listAssignableUsers()])
      .then(([p, u]) => {
        setPositions(p);
        setUsers(u);
      })
      .catch((e) => notify(e.message, "error"))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createPosition({ name: name.trim(), allowUnpost });
      setName("");
      setAllowUnpost(false);
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
    </div>
  );
}
