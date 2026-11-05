import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { SUBSCRIPTION_PLANS } from "../lib/subscriptionPlans";
import { ApiError } from "../api/http";
import "../styles/whatsapp.css";
import { buildWhatsAppLink, normalizeMobile } from "../lib/whatsapp";
import { COUNTRIES, CURRENCIES, defaultCurrencyForCountry } from "../shared/countries";

// اقتراح الدولة من المنطقة الزمنية للمتصفح (مصر لمن في القاهرة…) — مجرد افتراض أولي يغيّره المشترك.
const TIMEZONE_COUNTRY = { "Asia/Riyadh": "SA", "Asia/Dubai": "AE", "Africa/Cairo": "EG", "Asia/Kuwait": "KW", "Asia/Qatar": "QA", "Asia/Bahrain": "BH", "Asia/Muscat": "OM", "Asia/Amman": "JO", "Asia/Baghdad": "IQ", "Africa/Algiers": "DZ", "Africa/Casablanca": "MA", "Africa/Tunis": "TN", "Asia/Beirut": "LB", "Africa/Tripoli": "LY", "Africa/Khartoum": "SD", "Asia/Aden": "YE", "Asia/Gaza": "PS", "Asia/Hebron": "PS" };
function guessCountry() {
  try { return TIMEZONE_COUNTRY[Intl.DateTimeFormat(undefined, { calendar: "gregory" }).resolvedOptions().timeZone] || "SA"; } catch { return "SA"; }
}

export default function RegisterPage({ onGoLanding, onGoLogin }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const { register } = useAuth();
  const [searchParams] = useSearchParams();
  const planIds = SUBSCRIPTION_PLANS.map((plan) => plan.id);
  const [subscriptionPlan, setSubscriptionPlan] = useState(() => planIds.includes(searchParams.get("plan")) ? searchParams.get("plan") : "basic");
  const plans = t("landing.pricing.plans", { returnObjects: true });
  const [companyName, setCompanyName] = useState("");
  const [businessActivity, setBusinessActivity] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState(guessCountry);
  const [mobile, setMobile] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedCountry = COUNTRIES.find((c) => c.code === country) || COUNTRIES[0];
  const currency = CURRENCIES.find((c) => c.code === defaultCurrencyForCountry(country)) || CURRENCIES[0];

  const submit = async () => {
    if (!companyName || !businessActivity || !name || !email || !mobile || !password) { setError(t("auth.register.errFillAll")); return; }
    if (!normalizeMobile(mobile, country)) { setError(t("auth.register.errMobile", { example: selectedCountry.mobileExample })); return; }
    if (password !== confirmPassword) { setError(t("auth.register.errPasswordMismatch")); return; }
    if (password.length < 8) { setError(t("auth.register.errPasswordLength")); return; }
    setSubmitting(true);
    setError("");
    try {
      await register({ tenantName: companyName, businessActivity, name, email, country, mobile, whatsappOptIn, password, subscriptionPlan });
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
          <label>{ar ? "الدولة" : "Country"}<select value={country} onChange={(e) => setCountry(e.target.value)}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{ar ? c.nameAr : c.nameEn} (+{c.dialCode})</option>)}
          </select></label>
          <p className="note">{ar ? `عملة الشركة: ${currency.symbolAr} — ${currency.nameEn} (${currency.code})، وتُعدَّل لاحقاً من بيانات الشركة.` : `Company currency: ${currency.nameEn} (${currency.code}); you can change it later in company settings.`}</p>
          <label>{t("auth.register.mobile")}
            <span dir="ltr" style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
              <span aria-label={ar ? "مفتاح الدولة" : "Country code"} style={{ display: "flex", alignItems: "center", padding: "0 10px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc", fontWeight: 600, whiteSpace: "nowrap" }}>+{selectedCountry.dialCode}</span>
              <input type="tel" inputMode="tel" autoComplete="tel-national" dir="ltr" style={{ flex: 1, minWidth: 0 }} placeholder={selectedCountry.mobileExample} value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </span>
          </label>
          <label className="auth-optin"><input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} /><span>{t("auth.register.whatsappOptIn")}</span></label>
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
        <a className="link-btn auth-whatsapp-help whatsapp-link" href={buildWhatsAppLink(t("whatsapp.msgRegisterHelp"))} target="_blank" rel="noopener noreferrer">{t("whatsapp.registerHelp")}</a>
        <p className="note auth-note">{t("auth.register.note")}</p>
      </div>
    </div>
  );
}
