import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";

export default function AcceptInvitePage({ token, onGoLogin }) {
  const { t } = useTranslation();
  const { acceptInvite } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (password.length < 8) { setError(t("auth.register.errPasswordLength")); return; }
    if (password !== confirmPassword) { setError(t("auth.register.errPasswordMismatch")); return; }
    setSubmitting(true);
    setError("");
    try {
      await acceptInvite(token, password);
      // نجاح acceptInvite يُسجّل الدخول تلقائياً (applySession) — App.jsx سيعرض واجهة التطبيق
      // الرئيسية فور تحديث حالة isAuthenticated، فلا حاجة لأي تنقّل يدوي هنا.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.acceptInvite.errGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-card">
        <div className="landing-brand auth-brand">
          <div className="brand-mark landing-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <span>{t("common.brandName")}</span>
        </div>
        <h2 className="auth-title">{t("auth.acceptInvite.title")}</h2>

        {!token ? (
          <>
            <p className="balance-bad">{t("auth.acceptInvite.invalidToken")}</p>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>{t("auth.backToLogin")}</button>
            </div>
          </>
        ) : (
          <>
            <p className="note auth-note">{t("auth.acceptInvite.note")}</p>
            <div className="auth-form">
              <label>{t("auth.login.password")}
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label>{t("auth.resetPassword.confirmPasswordLabel")}
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </label>
              {error && <p className="balance-bad">{error}</p>}
              <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
                {submitting ? t("auth.acceptInvite.activating") : t("auth.acceptInvite.submitBtn")}
              </button>
            </div>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>{t("auth.backToLogin")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
