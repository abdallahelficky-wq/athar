import React, { useState } from "react";
import { useEmployeePortalAuth } from "../context/EmployeePortalAuthContext";

export default function LoginScreen() {
  const { login, rememberedTenantId } = useEmployeePortalAuth();
  const [tenantId, setTenantId] = useState(rememberedTenantId || "");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(tenantId.trim(), phone.trim(), pin.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="m-app">
      <div className="m-header">
        <div className="m-header-title">أثر المحاسبي</div>
        <div className="m-header-sub">بوابة الموظف</div>
      </div>
      <div className="m-main">
        <form className="m-card" onSubmit={submit}>
          <p style={{ marginTop: 0, fontSize: 13.5, color: "#6b7280" }}>
            سجّل الدخول لتسجيل حضورك وانصرافك ومتابعة طلبات إجازتك من هاتفك.
          </p>
          <div className="m-field">
            <label>رمز المنشأة</label>
            <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="يُرسَل لك من الموارد البشرية" required />
          </div>
          <div className="m-field">
            <label>رقم الجوال</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required />
          </div>
          <div className="m-field">
            <label>الرمز السري (PIN)</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" type="password" maxLength={6} required />
          </div>
          {error && <p className="m-error">{error}</p>}
          <button className="m-btn" disabled={loading} type="submit">{loading ? "جارٍ الدخول..." : "دخول"}</button>
        </form>
      </div>
    </div>
  );
}
