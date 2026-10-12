import "../styles/public-brand.css";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { fmt } from "../legacy/constants";
import LanguageSwitcher from "../wired/shared/LanguageSwitcher";

import { SUBSCRIPTION_PLANS } from "../lib/subscriptionPlans";

// تطبيقا أندرويد في أعلى الصفحة — نفس ملفات APK والأيقونات التي تخدمها صفحة /download (public/app/)،
// وبنفس نصوص الاسم والجمهور من مفاتيح download.*، فلا يوجد مصدر ثانٍ لأي منها. كل بطاقة تنزيل مباشر
// للـAPK بنقرة واحدة؛ خطوات التثبيت (ومنها الحذف لمرة واحدة للنسخ القديمة) تبقى على /download عبر
// رابط "خطوات التثبيت" أسفل البطاقتين.
const APPS = [
  { key: "pos", i18n: "download", apkPath: "/app/athar-pos.apk", apkFileName: "athar-pos.apk", iconPath: "/app/athar-pos-icon.png" },
  { key: "station", i18n: "download.station", apkPath: "/app/athar-station.apk", apkFileName: "athar-station.apk", iconPath: "/app/athar-station-icon.png" },
];

export default function LandingPage({ onGoLogin, onGoRegister, onGoDownload, onGoDataProtection }) {
  const { t } = useTranslation();
  const pricingRef = useRef(null);
  const navRef = useRef(null);
  const showPlans = () => {
    const section = pricingRef.current;
    if (!section) return;
    const nav = navRef.current;
    const stickyHeight = nav && getComputedStyle(nav).position === "sticky" ? nav.getBoundingClientRect().height : 0;
    section.style.scrollMarginTop = (stickyHeight + 16) + "px";
    section.focus({ preventScroll: true });
    section.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  const whyItems = t("landing.why.items", { returnObjects: true });
  const plans = t("landing.pricing.plans", { returnObjects: true });

  return (
    <div className="landing-root public-brand">
      <header className="landing-nav" ref={navRef}>
        <img src="/brand/athar-logo-horizontal.png" alt={t("common.brandName")} className="landing-logo" />
        <div className="landing-nav-actions">
          <LanguageSwitcher />
          <button className="btn-ghost landing-download-link" onClick={onGoDownload}>
            <span aria-hidden="true">⬇</span> {t("publicApps.title")}
          </button>
          <button className="btn-ghost" onClick={onGoDataProtection}>{t("landing.nav.dataProtection")}</button>
          <button className="btn-ghost" onClick={onGoLogin}>{t("landing.nav.login")}</button>
          <button className="btn-primary" onClick={showPlans}>{t("landing.nav.startTrial")}</button>
        </div>
      </header>

      <section className="landing-apps" aria-labelledby="landing-apps-title">
        <div className="landing-apps-head">
          <h2 id="landing-apps-title" className="landing-apps-title">{t("landing.apps.title")}</h2>
          <button type="button" className="landing-apps-steps" onClick={onGoDownload}>{t("landing.apps.installSteps")}</button>
        </div>
        <div className="landing-apps-grid">
          {APPS.map((app) => {
            const appName = t(`${app.i18n}.appName`);
            return (
              <a
                key={app.key}
                className="landing-app"
                href={app.apkPath}
                download={app.apkFileName}
                aria-label={t("download.downloadBtnFor", { app: appName })}
              >
                <img src={app.iconPath} alt="" className="landing-app-icon" width="52" height="52" />
                <span className="landing-app-text">
                  <span className="landing-app-name">{appName}</span>
                  <span className="landing-app-audience">{t(`${app.i18n}.audience`)}</span>
                </span>
                <span className="landing-app-get" aria-hidden="true">⬇</span>
              </a>
            );
          })}
        </div>
      </section>

      <section className="landing-hero">
        <div className="landing-eyebrow">{t("landing.eyebrow")}</div>
        <h1>{t("landing.title")}</h1>
        <p className="landing-hero-sub">{t("landing.heroSub")}</p>
        {/* دعوة أساسية واحدة هنا: تسجيل الدخول موجود دائماً في شريط التنقّل أعلاه وفي التذييل */}
        <div className="landing-hero-actions">
          <button className="btn-primary landing-cta" onClick={showPlans}>{t("landing.heroCtaTrial")}</button>
        </div>
      </section>

      <section className="landing-section">
        <div className="section-title landing-section-title">
          <span className="eyebrow">{t("landing.about.eyebrow")}</span>
          <h2>{t("landing.about.title")}</h2>
        </div>
        <p className="landing-about-text">{t("landing.about.text")}</p>
      </section>

      <section className="landing-section">
        <div className="section-title landing-section-title">
          <span className="eyebrow">{t("landing.why.eyebrow")}</span>
          <h2>{t("landing.why.title")}</h2>
        </div>
        <div className="why-us-grid">
          {whyItems.map((w) => (
            <div className="why-us-card" key={w.title}>
              <div className="why-us-title">{w.title}</div>
              <div className="why-us-desc">{w.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="pricing" ref={pricingRef} tabIndex={-1} aria-labelledby="pricing-title">
        <div className="section-title landing-section-title">
          <span className="eyebrow">{t("landing.pricing.eyebrow")}</span>
          <h2 id="pricing-title">{t("landing.pricing.title")}</h2>
        </div>
        <div className="trial-banner">{t("landing.pricing.trialBanner")}</div>
        <div className="pricing-grid">
          {plans.map((p, i) => (
            <div className={"pricing-card" + (i === 1 ? " pricing-highlighted" : "")} key={p.name}>
              {i === 1 && <div className="pricing-badge">{t("landing.pricing.mostPopular")}</div>}
              <div className="pricing-plan-name">{p.name}</div>
              <div className="pricing-plan-tagline">{p.tagline}</div>
              <div className="pricing-price"><span className="pricing-amount">{fmt(SUBSCRIPTION_PLANS[i].annualPrice)}</span> {t("landing.pricing.perYear")}</div>
              <div className="pricing-monthly-option">{t("landing.pricing.monthlyOption", { amount: fmt((SUBSCRIPTION_PLANS[i].annualPrice / 12) * 1.10) })}</div>
              <ul className="pricing-features">
                {p.features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <button className={i === 1 ? "btn-primary" : "btn-ghost"} onClick={() => onGoRegister(SUBSCRIPTION_PLANS[i].id)} style={{ width: "100%" }}>{t("landing.pricing.cta")}</button>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <div>{t("landing.footer.copyright")}</div>
        <div className="landing-footer-actions">
          <button className="btn-ghost" onClick={onGoDataProtection}>{t("landing.nav.dataProtection")}</button>
          <button className="btn-ghost" onClick={onGoLogin}>{t("landing.nav.login")}</button>
        </div>
      </footer>
    </div>
  );
}
