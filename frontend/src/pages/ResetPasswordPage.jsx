import React, { useState } from "react";
import { resetPassword } from "../api/auth";
import { ApiError } from "../api/http";

export default function ResetPasswordPage({ token, onGoLogin, onGoForgotPassword }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (password.length < 8) { setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل."); return; }
    if (password !== confirmPassword) { setError("كلمتا المرور غير متطابقتين."); return; }
    setSubmitting(true);
    setError("");
    try {
      await resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تعيين كلمة المرور، حاول مجدداً.");
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
        <h2 className="auth-title">تعيين كلمة مرور جديدة</h2>

        {!token ? (
          <>
            <p className="balance-bad">الرابط غير صالح أو منتهي، يرجى طلب رابط جديد.</p>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoForgotPassword}>طلب رابط جديد</button>
              <button className="link-btn" onClick={onGoLogin}>الرجوع لتسجيل الدخول</button>
            </div>
          </>
        ) : success ? (
          <>
            <p className="balance-good">تم تعيين كلمة المرور الجديدة بنجاح. تم أيضاً تسجيل الخروج من جميع الأجهزة الأخرى لحماية حسابك.</p>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>سجّل الدخول الآن</button>
            </div>
          </>
        ) : (
          <>
            <div className="auth-form">
              <label>كلمة المرور الجديدة
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label>تأكيد كلمة المرور
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </label>
              {error && (
                <>
                  <p className="balance-bad">{error}</p>
                  <button className="link-btn" onClick={onGoForgotPassword} style={{ marginTop: -8 }}>طلب رابط جديد</button>
                </>
              )}
              <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
                {submitting ? "جارٍ الحفظ..." : "تعيين كلمة المرور"}
              </button>
            </div>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>الرجوع لتسجيل الدخول</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
