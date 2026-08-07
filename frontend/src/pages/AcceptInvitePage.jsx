import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";

export default function AcceptInvitePage({ token, onGoLogin }) {
  const { acceptInvite } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (password.length < 8) { setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل."); return; }
    if (password !== confirmPassword) { setError("كلمتا المرور غير متطابقتين."); return; }
    setSubmitting(true);
    setError("");
    try {
      await acceptInvite(token, password);
      // نجاح acceptInvite يُسجّل الدخول تلقائياً (applySession) — App.jsx سيعرض واجهة التطبيق
      // الرئيسية فور تحديث حالة isAuthenticated، فلا حاجة لأي تنقّل يدوي هنا.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تفعيل الحساب، حاول مجدداً.");
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
        <h2 className="auth-title">تفعيل حسابك</h2>

        {!token ? (
          <>
            <p className="balance-bad">رابط الدعوة غير صالح أو منتهي، تواصل مع مدير النظام لديك للحصول على دعوة جديدة.</p>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>الرجوع لتسجيل الدخول</button>
            </div>
          </>
        ) : (
          <>
            <p className="note auth-note">اختر كلمة مرور لحسابك لإتمام تفعيله — سيتم تسجيل دخولك تلقائياً بعد ذلك.</p>
            <div className="auth-form">
              <label>كلمة المرور
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
              {error && <p className="balance-bad">{error}</p>}
              <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
                {submitting ? "جارٍ التفعيل..." : "تفعيل الحساب والدخول"}
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
