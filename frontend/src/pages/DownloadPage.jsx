import React from "react";
import { useTranslation } from "react-i18next";

// تطبيقات أندرويد المنشورة هنا — كل APK مُثبَّت فعلياً كملف ثابت (public/app/*.apk) لا مجلوب عند الطلب
// من إصدار GitHub، حتى تعمل هذه الصفحة بلا أي اعتماد على GitHub وقت التنزيل (ولا حاجة لتسجيل دخول
// مطلقاً، مطابقاً لطلب "تنزيل بلا فتح GitHub"). لتحديث أيٍّ منهما لبناء أحدث، راجع تعليق "لتحديث
// النسخة" أسفل هذا الملف. الترتيب مقصود: نقطة البيع أولاً، ثم تطبيق عامل المحطة أسفلها.
const APPS = [
  {
    key: "pos",
    i18n: "download",
    apkPath: "/app/athar-pos.apk",
    apkFileName: "athar-pos.apk",
    iconPath: "/app/athar-pos-icon.png",
    version: "1.2", // مطابق لـ versionName في android/app/build.gradle.kts
    sizeLabel: "٤.٦ ميجابايت", // 4,827,742 بايت (إصدار android-pos-v1.2 الموقَّع) — راجع تعليق التحديث أدناه
  },
  {
    key: "station",
    i18n: "download.station",
    apkPath: "/app/athar-station.apk",
    apkFileName: "athar-station.apk",
    iconPath: "/app/athar-station-icon.png",
    version: "1.1", // مطابق لـ versionName في android-station/app/build.gradle.kts
    sizeLabel: "٤.٦ ميجابايت", // 4,842,446 بايت (إصدار android-station-v1.1 الموقَّع) — راجع تعليق التحديث أدناه
  },
];

function AppEntry({ app }) {
  const { t } = useTranslation();
  const appName = t(`${app.i18n}.appName`);
  return (
    <section className="download-entry" aria-labelledby={`download-${app.key}-name`}>
      <img src={app.iconPath} alt="" className="download-app-icon" width="72" height="72" />
      <h2 id={`download-${app.key}-name`} className="auth-title download-app-name">{appName}</h2>
      <p className="download-audience">{t(`${app.i18n}.audience`)}</p>
      <div className="download-meta">
        <span className="download-version">{t("download.version", { version: app.version })}</span>
        <span className="download-size">{app.sizeLabel}</span>
      </div>
      <p className="note download-desc">{t(`${app.i18n}.description`)}</p>

      <a className="btn-primary download-btn" href={app.apkPath} download={app.apkFileName}>
        {t("download.downloadBtnFor", { app: appName })}
      </a>

      <div className="download-steps">
        <div className="download-steps-title">{t("download.stepsTitle")}</div>
        <ol>
          <li>{t("download.stepUninstallOld")}</li>
          <li>{t("download.step1")}</li>
          <li>{t("download.stepOpenFile", { fileName: app.apkFileName })}</li>
        </ol>
      </div>

      <p className="note auth-note download-disclaimer">{t(`${app.i18n}.disclaimer`)}</p>
    </section>
  );
}

export default function DownloadPage() {
  const { t } = useTranslation();
  return (
    <div className="auth-root">
      <div className="auth-card download-card">
        <img src="/brand/athar-logo-horizontal.png" alt={t("common.brandName")} className="auth-logo" />
        {APPS.map((app) => <AppEntry key={app.key} app={app} />)}
      </div>
    </div>
  );
}

// لتحديث النسخة المنشورة هنا لبناء أحدث:
//   نقطة البيع (android/):
//     1. شغِّل .github/workflows/android-build.yml يدوياً على production (workflow_dispatch) بوسم إصدار
//        مثبَّت (مثال android-pos-v1.2)، ثم وافق على نشر بيئة android-release حين يطلبها GitHub.
//     2. نزِّل APK الناتج من صفحة الإصدار على GitHub واستبدل به frontend/public/app/athar-pos.apk.
//   عامل المحطة (android-station/):
//     1. شغِّل .github/workflows/android-station-build.yml يدوياً على production بوسم (مثال
//        android-station-v1.1) — لا يبدأ التوقيع إلا بعد نجاح اختبار التصوير على المحاكي وموافقتك على
//        بيئة android-release.
//     2. نزِّل APK الناتج من صفحة الإصدار واستبدل به frontend/public/app/athar-station.apk.
//   ثم لكليهما: تحقّق بـ `aapt2 dump badging` أن applicationId/versionName صحيحان، وبـ `apksigner verify
//   --print-certs` أن بصمة الشهادة SHA-256 هي بصمة مفتاح الإصدار الدائم
//   (35e7bb91e52eaeff6921e7042c5952c5cb88cf79d7ed1b497931d91944b9600d) — أي بصمة أخرى تعني أن التحديث لن
//   يُثبَّت فوق النسخ الموجودة على الأجهزة. وحدِّث version
//   وsizeLabel في APPS أعلاه ليطابقا versionName الفعلي وحجم الملف الجديد، ثم أعد بناء الواجهة
//   (npm run build) وتحقّق من ظهور الملف في dist/app/.
