import React from "react";
import { useTranslation } from "react-i18next";

// نسخة APK نقطة البيع لأندرويد (Sunmi V2) — مُثبَّتة هنا فعلياً كملف ثابت (public/app/athar-pos.apk)
// لا مجلوبة عند الطلب من إصدار GitHub، حتى تعمل هذه الصفحة بلا أي اعتماد على GitHub وقت التنزيل
// (ولا حاجة لتسجيل دخول مطلقاً، مطابقاً لطلب "تنزيل بلا فتح GitHub"). لتحديثها لبناء أحدث، راجع
// تعليق "لتحديث النسخة" أسفل هذا الملف.
const APK_PATH = "/app/athar-pos.apk";
const APK_VERSION = "1.1"; // مطابق لـ versionName في android/app/build.gradle.kts
const APK_SIZE_LABEL = "٥.٦ ميجابايت"; // 5,882,270 بايت وقت آخر تحديث لهذا الملف — راجع تعليق التحديث أدناه

export default function DownloadPage() {
  const { t } = useTranslation();
  return (
    <div className="auth-root">
      <div className="auth-card download-card">
        <img src="/brand/athar-logo-horizontal.png" alt={t("common.brandName")} className="auth-logo" />
        <h1 className="auth-title download-app-name">{t("download.appName")}</h1>
        <div className="download-meta">
          <span className="download-version">{t("download.version", { version: APK_VERSION })}</span>
          <span className="download-size">{APK_SIZE_LABEL}</span>
        </div>
        <p className="note download-desc">{t("download.description")}</p>

        <a className="btn-primary download-btn" href={APK_PATH} download="athar-pos.apk">
          {t("download.downloadBtn")}
        </a>

        <div className="download-steps">
          <div className="download-steps-title">{t("download.stepsTitle")}</div>
          <ol>
            <li>{t("download.step1")}</li>
            <li>{t("download.step2")}</li>
          </ol>
        </div>

        <p className="note auth-note download-disclaimer">{t("download.disclaimer")}</p>
      </div>
    </div>
  );
}

// لتحديث النسخة المنشورة هنا لبناء أحدث من مستودع أندرويد (android/):
//   1. إمّا ادفع تعديلاً على android/** إلى فرع feature/android-pos-wrapper (يُحدِّث تلقائياً
//      إصدار GitHub الدائري android-pos-latest عبر .github/workflows/android-build.yml)، أو شغِّل
//      هذا الفحص يدوياً (workflow_dispatch) بوسم إصدار مثبَّت (مثال android-pos-v0.1.1) لبناء ثابت.
//   2. نزِّل ملف APK الناتج من صفحة الإصدار على GitHub.
//   3. استبدل frontend/public/app/athar-pos.apk بالملف الجديد (نفس الاسم بالضبط).
//   4. حدِّث APK_VERSION وAPK_SIZE_LABEL أعلاه ليطابقا versionName الفعلي في
//      android/app/build.gradle.kts وحجم الملف الجديد.
//   5. أعد بناء الواجهة الأمامية (npm run build) وتحقّق من ظهور الملف في dist/app/athar-pos.apk.
