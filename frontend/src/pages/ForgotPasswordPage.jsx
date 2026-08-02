import React, { useState } from "react";
import { forgotPassword } from "../api/auth";
import { ApiError } from "../api/http";

export default function ForgotPasswordPage({ onGoLogin }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email) { setError("أدخل بريدك الإلكتروني."); return; }
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const result = await forgotPassword(email);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر إرسال الطلب، حاول مجدداً.");
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
        <h2 className="auth-title">نسيت كلمة المرور؟</h2>
        {message ? (
          <p className="balance-good">{message}</p>
        ) : (
          <div className="auth-form">
            <label>البريد الإلكتروني
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.sa"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </label>
            {error && <p className="balance-bad">{error}</p>}
            <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
              {submitting ? "جارٍ الإرسال..." : "إرسال رابط إعادة التعيين"}
            </button>
          </div>
        )}
        <div className="auth-links">
          <button className="link-btn" onClick={onGoLogin}>الرجوع لتسجيل الدخول</button>
        </div>
      </div>
    </div>
  );
}
