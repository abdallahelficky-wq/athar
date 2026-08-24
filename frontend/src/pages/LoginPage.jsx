import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../api/http";

/** رسم توضيحي (SVG) مجرَّد يعكس روح النظام (نمو مالي/لوحة قيادة) بألوان الهوية الجديدة —
 * بديل عن صورة فوتوغرافية عشوائية بلا حقوق ملكية مضمونة. مُضمَّن هنا مباشرة (لا كملف صورة
 * منفصل) لأنه مخصَّص لهذه الصفحة فقط. */
function LoginIllustration() {
  return (
    <svg viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg" className="login-illustration-svg" aria-hidden="true">
      <circle cx="60" cy="50" r="3" fill="#B98B4E" opacity="0.6" />
      <circle cx="380" cy="80" r="4" fill="#C8102E" opacity="0.5" />
      <circle cx="40" cy="270" r="3" fill="#C8102E" opacity="0.4" />
      <circle cx="395" cy="260" r="3" fill="#B98B4E" opacity="0.5" />

      <rect x="30" y="60" width="360" height="220" rx="18" fill="#1c1c1c" stroke="#2c2c2c" />

      <g transform="translate(58, 96)">
        <rect x="0" y="110" width="34" height="60" rx="6" fill="#7A0F1F" />
        <rect x="46" y="80" width="34" height="90" rx="6" fill="#A00D25" />
        <rect x="92" y="50" width="34" height="120" rx="6" fill="#C8102E" />
        <rect x="138" y="20" width="34" height="150" rx="6" fill="#E5395A" />
      </g>

      <path
        d="M60 210 L120 165 L165 190 L230 110 L305 70"
        stroke="#B98B4E" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 8" fill="none"
      />
      <path d="M290 62 L308 68 L302 86" stroke="#B98B4E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      <rect x="248" y="96" width="108" height="30" rx="8" fill="#141414" stroke="#333" />
      <circle cx="264" cy="111" r="6" fill="#2F5D5A" />
      <rect x="278" y="106" width="60" height="4" rx="2" fill="#4a4a4a" />
      <rect x="278" y="114" width="40" height="4" rx="2" fill="#333" />
    </svg>
  );
}

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

  const heroBullets = t("auth.login.heroBullets", { returnObjects: true });

  return (
    <div className="login-split-root">
      <div className="login-illustration-panel">
        <div className="login-illustration-content">
          <div className="landing-brand auth-brand login-illustration-brand">
            <div className="brand-mark landing-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
            <span>{t("common.brandName")}</span>
          </div>
          <h1 className="login-hero-title">{t("auth.login.heroTitle")}</h1>
          <p className="login-hero-subtitle">{t("auth.login.heroSubtitle")}</p>
          <LoginIllustration />
          <ul className="login-hero-bullets">
            {Array.isArray(heroBullets) && heroBullets.map((b, i) => (
              <li key={i}><span className="login-hero-bullet-dot" />{b}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="auth-card login-form-card">
          <h2 className="auth-title">{t("auth.login.title")}</h2>
          <div className="auth-form">
            <label>{t("auth.login.email")}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
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
    </div>
  );
}
