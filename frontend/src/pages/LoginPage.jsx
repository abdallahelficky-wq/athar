import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";

export default function LoginPage({ onGoLanding, onGoRegister, onGoForgotPassword }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email || !password) { setError("يرجى تعبئة البريد الإلكتروني وكلمة المرور."); return; }
    setSubmitting(true);
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تسجيل الدخول، حاول مجدداً.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-card">
        <div className="landing-brand auth-brand">
          <div className="brand-mark landing-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <span>أثر المحاسبي</span>
        </div>
        <h2 className="auth-title">تسجيل الدخول</h2>
        <div className="auth-form">
          <label>البريد الإلكتروني
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.sa" />
          </label>
          <label>كلمة المرور
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          {error && <p className="balance-bad">{error}</p>}
          <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
            {submitting ? "جارٍ الدخول..." : "دخول"}
          </button>
        </div>
        <div className="auth-links">
          <button className="link-btn" onClick={onGoForgotPassword}>نسيت كلمة المرور؟</button>
          <button className="link-btn" onClick={onGoRegister}>ليس لديك حساب؟ سجّل الآن</button>
          <button className="link-btn" onClick={onGoLanding}>الرجوع للصفحة الرئيسية</button>
        </div>
        <p className="note auth-note">هذا الحساب متصل فعلياً بقاعدة بيانات حقيقية — بياناتك معزولة تماماً عن أي مستأجر آخر.</p>
      </div>
    </div>
  );
}
