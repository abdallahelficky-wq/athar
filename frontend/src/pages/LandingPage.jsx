import React from "react";
import { useTranslation } from "react-i18next";
import { fmt } from "../legacy/constants";
import LanguageSwitcher from "../wired/shared/LanguageSwitcher";

const PRICES = [500, 1000, 1500];

export default function LandingPage({ onGoLogin, onGoRegister }) {
  const { t } = useTranslation();
  const whyItems = t("landing.why.items", { returnObjects: true });
  const plans = t("landing.pricing.plans", { returnObjects: true });

  return (
    <div className="landing-root">
      <header className="landing-nav">
        <div className="landing-brand">
          <div className="brand-mark landing-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <span>{t("common.brandName")}</span>
        </div>
        <div className="landing-nav-actions">
          <LanguageSwitcher />
          <button className="btn-ghost" onClick={onGoLogin}>{t("landing.nav.login")}</button>
          <button className="btn-primary" onClick={onGoRegister}>{t("landing.nav.startTrial")}</button>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-eyebrow">{t("landing.eyebrow")}</div>
        <h1>{t("landing.title")}</h1>
        <p className="landing-hero-sub">{t("landing.heroSub")}</p>
        <div className="landing-hero-actions">
          <button className="btn-primary landing-cta" onClick={onGoRegister}>{t("landing.heroCtaTrial")}</button>
          <button className="btn-ghost landing-cta" onClick={onGoLogin}>{t("landing.heroCtaLogin")}</button>
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

      <section className="landing-section" id="pricing">
        <div className="section-title landing-section-title">
          <span className="eyebrow">{t("landing.pricing.eyebrow")}</span>
          <h2>{t("landing.pricing.title")}</h2>
        </div>
        <div className="trial-banner">{t("landing.pricing.trialBanner")}</div>
        <div className="pricing-grid">
          {plans.map((p, i) => (
            <div className={"pricing-card" + (i === 1 ? " pricing-highlighted" : "")} key={p.name}>
              {i === 1 && <div className="pricing-badge">{t("landing.pricing.mostPopular")}</div>}
              <div className="pricing-plan-name">{p.name}</div>
              <div className="pricing-plan-tagline">{p.tagline}</div>
              <div className="pricing-price"><span className="pricing-amount">{fmt(PRICES[i])}</span> {t("landing.pricing.perYear")}</div>
              <div className="pricing-monthly-option">{t("landing.pricing.monthlyOption", { amount: fmt((PRICES[i] / 12) * 1.10) })}</div>
              <ul className="pricing-features">
                {p.features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              <button className={i === 1 ? "btn-primary" : "btn-ghost"} onClick={onGoRegister} style={{ width: "100%" }}>{t("landing.pricing.cta")}</button>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <div>{t("landing.footer.copyright")}</div>
        <button className="btn-ghost" onClick={onGoLogin}>{t("landing.nav.login")}</button>
      </footer>
    </div>
  );
}
