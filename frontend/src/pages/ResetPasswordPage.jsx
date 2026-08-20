import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { resetPassword } from "../api/auth";
import { ApiError } from "../api/http";

export default function ResetPasswordPage({ token, onGoLogin, onGoForgotPassword }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (password.length < 8) { setError(t("auth.register.errPasswordLength")); return; }
    if (password !== confirmPassword) { setError(t("auth.register.errPasswordMismatch")); return; }
    setSubmitting(true);
    setError("");
    try {
      await resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.resetPassword.errGeneric"));
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
        <h2 className="auth-title">{t("auth.resetPassword.title")}</h2>

        {!token ? (
          <>
            <p className="balance-bad">{t("auth.resetPassword.invalidToken")}</p>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoForgotPassword}>{t("auth.resetPassword.requestNewLink")}</button>
              <button className="link-btn" onClick={onGoLogin}>{t("auth.backToLogin")}</button>
            </div>
          </>
        ) : success ? (
          <>
            <p className="balance-good">{t("auth.resetPassword.successMsg")}</p>
            <div className="auth-links">
              <button className="link-btn" onClick={onGoLogin}>{t("auth.resetPassword.loginNow")}</button>
            </div>
          </>
        ) : (
          <>
            <div className="auth-form">
              <label>{t("auth.resetPassword.newPasswordLabel")}
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
              {error && (
                <>
                  <p className="balance-bad">{error}</p>
                  <button className="link-btn" onClick={onGoForgotPassword} style={{ marginTop: -8 }}>{t("auth.resetPassword.requestNewLink")}</button>
                </>
              )}
              <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
                {submitting ? t("settings.myAccount.saving") : t("auth.resetPassword.submitBtn")}
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
