import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/http";

export default function PosLoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pos-login-root">
      <form className="pos-login-card" onSubmit={submit}>
        <div className="pos-login-brand">أثر المحاسبي — نقطة البيع</div>
        <label className="m-field">
          البريد الإلكتروني
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="m-field">
          كلمة المرور
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="m-error">{error}</p>}
        <button className="pos-big-btn" type="submit" disabled={submitting}>{submitting ? "جارٍ الدخول..." : "دخول"}</button>
      </form>
    </div>
  );
}
