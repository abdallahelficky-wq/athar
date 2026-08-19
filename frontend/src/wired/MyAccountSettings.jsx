import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";

/** تعديل الاسم الحقيقي لحساب المستخدم الحالي — يظهر في السطر العلوي (topbar) بجانب اسم
 * المنشأة. ضروري خصوصاً لتصحيح اسم أُدخل بترميز خاطئ عند إنشاء الحساب لأول مرة. */
export default function MyAccountSettings() {
  const { t } = useTranslation();
  const { user, renameMe } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) { setError(t("settings.myAccount.errRequired")); return; }
    setSaving(true);
    setError("");
    try {
      await renameMe(name.trim());
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel form-panel">
      <h3>{t("settings.myAccount.title")}</h3>
      {editing ? (
        <div className="form-grid" style={{ alignItems: "end" }}>
          <label>{t("settings.myAccount.nameLabel")}<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t("settings.myAccount.saving") : t("common.save")}</button>
          </label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-ghost" onClick={() => { setEditing(false); setName(user?.name || ""); setError(""); }}>{t("common.cancel")}</button>
          </label>
        </div>
      ) : (
        <div className="form-btn-group">
          <span className="status-badge">{user?.name}</span>
          <span className="note" style={{ margin: 0 }}>{user?.email}</span>
          <button className="btn-ghost" onClick={() => setEditing(true)}>{t("settings.myAccount.editBtn")}</button>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}
