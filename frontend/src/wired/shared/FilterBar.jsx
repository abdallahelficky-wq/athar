import React from "react";
import { useTranslation } from "react-i18next";

/**
 * حاوية تخطيط عامة لأي لوحة فلاتر بنمط برامج المحاسبة (شبكة حقول + زرّا بحث/إعادة تعيين) — لا
 * تعرف شيئاً عن نوع الحقول نفسها (كل شاشة تمرّرها كـchildren)، فتُعاد استخدامها لاحقاً لشاشات
 * المردودات/سندات القبض/عروض الأسعار بمجرد تمرير حقولها الخاصة، دون تكرار تخطيط الشبكة أو منطق
 * زرّي البحث/التصفير في كل شاشة.
 */
export default function FilterBar({ children, onSearch, onReset }) {
  const { t } = useTranslation();
  return (
    <form
      className="filter-bar document-filter-bar"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
    >
      {children}
      <div className="filter-bar-actions">
        <button type="submit" className="btn-primary">{t("filters.search")}</button>
        <button type="button" className="btn-ghost" onClick={onReset}>{t("filters.reset")}</button>
      </div>
    </form>
  );
}
