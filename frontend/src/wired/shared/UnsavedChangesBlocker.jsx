import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router-dom";
import { useAnyUnsavedChanges } from "./UnsavedChangesContext";

/**
 * يعترض أي تنقّل داخل التطبيق (نقر رابط بالقائمة الجانبية أو غيرها) طالما يوجد نموذج معدَّل غير
 * محفوظ (useAnyUnsavedChanges)، ويعرض نافذة تأكيد بثلاثة خيارات واضحة. كما يُفعِّل تحذير المتصفح
 * القياسي (beforeunload) عند إغلاق التبويب/تحديث الصفحة — المتصفحات الحديثة تتجاهل أي نص مخصَّص
 * وتعرض رسالتها الثابتة الخاصة، والمطلوب فقط تفعيل ظهورها أصلاً.
 * يُركَّب مرة واحدة داخل AppShell (بعد توفّر سياق الراوتر) لا داخل كل نموذج على حدة.
 *
 * تنبيه مهم: useBlocker يجب أن يستقبل دالة بمرجع ثابت (useCallback)، لا دالة سطرية جديدة بكل
 * تصيير — تمرير دالة جديدة كل مرة يجعل react-router يُعيد تسجيل الحارس بشكل متكرر، ما يسبب حلقة
 * تصيير لا تنتهي عملياً (لوحظ فعلياً أثناء الاختبار: مئات نداءات render/blockerFn بلا استقرار).
 */
export default function UnsavedChangesBlocker() {
  const { t } = useTranslation();
  const hasUnsaved = useAnyUnsavedChanges();

  const shouldBlock = useCallback(
    ({ currentLocation, nextLocation }) => hasUnsaved
      && (currentLocation.pathname + currentLocation.search) !== (nextLocation.pathname + nextLocation.search),
    [hasUnsaved],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!hasUnsaved) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsaved]);

  if (blocker.state !== "blocked") return null;

  const openInNewTab = () => {
    const { pathname, search, hash } = blocker.location;
    window.open(pathname + search + hash, "_blank", "noopener,noreferrer");
    blocker.reset();
  };

  return (
    <div className="unsaved-changes-overlay" onClick={(e) => e.target === e.currentTarget && blocker.reset()}>
      <div className="unsaved-changes-box">
        <h3>{t("unsavedChanges.title")}</h3>
        <p>{t("unsavedChanges.body")}</p>
        <div className="unsaved-changes-actions">
          <button type="button" className="btn-ghost" onClick={() => blocker.reset()}>{t("unsavedChanges.stayOnPage")}</button>
          <button type="button" className="btn-ghost" onClick={openInNewTab}>{t("unsavedChanges.openInNewTab")}</button>
          <button type="button" className="btn-primary unsaved-changes-leave-btn" onClick={() => blocker.proceed()}>{t("unsavedChanges.leaveWithoutSaving")}</button>
        </div>
      </div>
    </div>
  );
}
