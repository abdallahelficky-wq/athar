import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";

export default function RegisterPage({ onGoLanding, onGoLogin }) {
  const { t } = useTranslation();
  const { register } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [businessActivity, setBusinessActivity] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!companyName || !businessActivity || !name || !email || !password) { setError(t("auth.register.errFillAll")); return; }
    if (password !== confirmPassword) { setError(t("auth.register.errPasswordMismatch")); return; }
    if (password.length < 8) { setError(t("auth.register.errPasswordLength")); return; }
    setSubmitting(true);
    setError("");
    try {
      await register({ tenantName: companyName, businessActivity, name, email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.register.errGeneric"));
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
        <h2 className="auth-title">{t("auth.register.title")}</h2>
        <div className="auth-form">
          <label>{t("auth.register.companyName")}<input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></label>
          <label>{t("auth.register.businessActivity")}<select value={businessActivity} onChange={(e) => setBusinessActivity(e.target.value)}><option value="">{t("auth.register.selectActivity")}</option><option value="contracting">{t("auth.register.activities.contracting")}</option><option value="manufacturing">{t("auth.register.activities.manufacturing")}</option><option value="retail">{t("auth.register.activities.retail")}</option><option value="general_trade">{t("auth.register.activities.generalTrade")}</option><option value="fuel_stations">{t("auth.register.activities.fuelStations")}</option><option value="horse_stables">{t("auth.register.activities.horseStables")}</option></select></label>
          <label>{t("auth.register.fullName")}<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>{t("auth.register.email")}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>{t("auth.register.password")}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>{t("auth.register.confirmPassword")}<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label>
          {error && <p className="balance-bad">{error}</p>}
          <button className="btn-primary auth-submit" onClick={submit} disabled={submitting}>
            {submitting ? t("auth.register.submitting") : t("auth.register.submit")}
          </button>
        </div>
        <div className="auth-links">
          <button className="link-btn" onClick={onGoLogin}>{t("auth.register.haveAccount")}</button>
          <button className="link-btn" onClick={onGoLanding}>{t("auth.register.backToLanding")}</button>
        </div>
        <p className="note auth-note">{t("auth.register.note")}</p>
      </div>
    </div>
  );
}
