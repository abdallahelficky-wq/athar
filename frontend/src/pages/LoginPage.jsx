import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";

export default function LoginPage({ onGoLanding, onGoRegister, onGoForgotPassword }) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email || !password) { setError(t("auth.login.errFillFields")); return; }
    setSubmitting(true);
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.login.errGeneric"));
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
        <h2 className="auth-title">{t("auth.login.title")}</h2>
        <div className="auth-form">
          <label>{t("auth.login.email")}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.sa" />
          </label>
          <label>{t("auth.login.password")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          {error && <p className="balance-bad">{error}</p>}
          <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
            {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
          </button>
        </div>
        <div className="auth-links">
          <button className="link-btn" onClick={onGoForgotPassword}>{t("auth.login.forgotPassword")}</button>
          <button className="link-btn" onClick={onGoRegister}>{t("auth.login.noAccount")}</button>
          <button className="link-btn" onClick={onGoLanding}>{t("auth.login.backToLanding")}</button>
        </div>
        <p className="note auth-note">{t("auth.login.note")}</p>
      </div>
    </div>
  );
}
