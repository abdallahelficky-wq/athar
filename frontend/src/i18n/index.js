import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./ar.json";
import en from "./en.json";

export const STORAGE_KEY = "athar.language";
export const SUPPORTED_LANGUAGES = ["ar", "en"];
const DIR_BY_LANGUAGE = { ar: "rtl", en: "ltr" };

function loadStoredLanguage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(stored) ? stored : "ar";
}

function applyDocumentDirection(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = DIR_BY_LANGUAGE[lang] || "rtl";
}

const initialLanguage = loadStoredLanguage();

i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: initialLanguage,
  fallbackLng: "ar",
  interpolation: { escapeValue: false },
});

// يُحدَّث اتجاه المستند/localStorage تلقائياً أياً كان مصدر تغيير اللغة (زرار التبديل، أو أي
// استدعاء مستقبلي لـ i18n.changeLanguage) — نقطة مركزية واحدة بدل تكرار المنطق في كل مكان.
i18n.on("languageChanged", (lang) => {
  applyDocumentDirection(lang);
  localStorage.setItem(STORAGE_KEY, lang);
});

// تطبيق فوري عند التحميل الأول (قبل أي تغيير لاحق) — حتى لو كانت اللغة المحفوظة مطابقة للقيمة
// الافتراضية الثابتة في index.html (ar/rtl)، هذا يضمن التطابق دائماً بلا افتراض صامت.
applyDocumentDirection(initialLanguage);

export default i18n;
