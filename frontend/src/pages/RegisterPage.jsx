import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { SUBSCRIPTION_PLANS } from "../lib/subscriptionPlans";
import { ApiError } from "../api/http";

export default function RegisterPage({ onGoLanding, onGoLogin }) {
  const { t } = useTranslation();
  const { register } = useAuth();
  const [searchParams] = useSearchParams();
  const planIds = SUBSCRIPTION_PLANS.map((plan) => plan.id);
  const [subscriptionPlan, setSubscriptionPlan] = useState(() => planIds.includes(searchParams.get("plan")) ? searchParams.get("plan") : "basic");
  const plans = t("landing.pricing.plans", { returnObjects: true });
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
      await register({ tenantName: companyName, businessActivity, name, email, password, subscriptionPlan });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.register.errGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-card">
        <img src="/brand/athar-logo-horizontal.png" alt={t("common.brandName")} className="auth-logo" />
        <h2 className="auth-title">{t("auth.register.title")}</h2>
        <div className="auth-form">
          <label>{t("auth.register.plan")}<select value={subscriptionPlan} onChange={(e) => setSubscriptionPlan(e.target.value)}>
            {planIds.map((id, index) => <option key={id} value={id}>{plans[index].name}</option>)}
          </select></label>
          <p className="note">{SUBSCRIPTION_PLANS.find((plan) => plan.id === subscriptionPlan).annualPrice} {t("landing.pricing.perYear")}</p>
          <p className="note">{t("auth.register.planTrialNote")}</p>
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
