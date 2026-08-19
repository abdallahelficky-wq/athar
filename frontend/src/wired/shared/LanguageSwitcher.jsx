import React from "react";
import { useTranslation } from "react-i18next";

const OTHER_LANGUAGE = { ar: "en", en: "ar" };
const LABEL = { ar: "EN", en: "ع" };

/** زرار تبديل لغة الواجهة (عربي/إنجليزي) — يعرض دائماً اسم اللغة التي سيتحول إليها الضغط، ويقلب
 * اتجاه المستند بالكامل تلقائياً (انظر i18n/index.js: مستمع languageChanged). */
export default function LanguageSwitcher({ className = "" }) {
  const { i18n, t } = useTranslation();
  const current = i18n.language;
  const target = OTHER_LANGUAGE[current] || "ar";

  return (
    <button
      type="button"
      className={`language-switcher-btn ${className}`.trim()}
      onClick={() => i18n.changeLanguage(target)}
      title={target === "en" ? t("common.switchToEnglish") : t("common.switchToArabic")}
    >
      {LABEL[current] || "EN"}
    </button>
  );
}
