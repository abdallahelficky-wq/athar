import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";

/** تعديل الاسم الحقيقي لحساب المستخدم الحالي — يظهر في السطر العلوي (topbar) بجانب اسم
 * المنشأة. ضروري خصوصاً لتصحيح اسم أُدخل بترميز خاطئ عند إنشاء الحساب لأول مرة. */
export default function MyAccountSettings() {
  const { user, renameMe } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) { setError("الاسم مطلوب"); return; }
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
      <h3>اسمي (يظهر في أعلى الشاشة بجانب اسم المنشأة)</h3>
      {editing ? (
        <div className="form-grid" style={{ alignItems: "end" }}>
          <label>الاسم الكامل<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</button>
          </label>
          <label style={{ alignSelf: "end" }}>
            <button className="btn-ghost" onClick={() => { setEditing(false); setName(user?.name || ""); setError(""); }}>إلغاء</button>
          </label>
        </div>
      ) : (
        <div className="form-btn-group">
          <span className="status-badge">{user?.name}</span>
          <span className="note" style={{ margin: 0 }}>{user?.email}</span>
          <button className="btn-ghost" onClick={() => setEditing(true)}>تعديل الاسم</button>
        </div>
      )}
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}
