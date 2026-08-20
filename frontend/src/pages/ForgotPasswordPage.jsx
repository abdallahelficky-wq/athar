import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { forgotPassword } from "../api/auth";
import { ApiError } from "../api/http";

export default function ForgotPasswordPage({ onGoLogin }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email) { setError(t("auth.forgotPassword.errNoEmail")); return; }
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const result = await forgotPassword(email);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.forgotPassword.errGeneric"));
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
        <h2 className="auth-title">{t("auth.forgotPassword.title")}</h2>
        {message ? (
          <p className="balance-good">{message}</p>
        ) : (
          <div className="auth-form">
            <label>{t("auth.login.email")}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </label>
            {error && <p className="balance-bad">{error}</p>}
            <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
              {submitting ? t("auth.forgotPassword.sending") : t("auth.forgotPassword.submitBtn")}
            </button>
          </div>
        )}
        <div className="auth-links">
          <button className="link-btn" onClick={onGoLogin}>{t("auth.backToLogin")}</button>
        </div>
      </div>
    </div>
  );
}
