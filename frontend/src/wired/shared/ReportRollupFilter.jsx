import React from "react";
import { useTranslation } from "react-i18next";
import AccountSearchSelect from "./AccountSearchSelect";

/**
 * منطق فلترة مشترك لكل التقارير المالية (ميزان المراجعة، قائمة الدخل، المركز المالي، كشف حساب
 * الأستاذ، وأي تقرير مالي مستقبلي): اختيار مستوى التجميع (1-4)، فلترة بفرع/حساب معيّن من ذلك
 * المستوى، وتبديل "بالتفاصيل/بدون تفاصيل" يظهر فقط بعد اختيار فرع محدَّد. القيم الثلاث تُمرَّر
 * مباشرة كـ query params لأي endpoint تقرير يدعم rollupParams في الخادم (level/accountId/
 * includeDetails/search) — نفس العقد بلا أي منطق مكرَّر لكل شاشة تقرير.
 */
/**
 * تُمرَّر قيم الحقول (values) كـ "مسودة" غير مطبَّقة بعد — التعديل هنا لا يستدعي أي API ولا يعيد
 * حساب أي نتيجة، فقط يحدّث ما يُعرَض في الحقول (Controlled). المطبِّق (parent) هو من يقرر متى
 * يعتمد هذه القيم فعلياً (بالضغط على "إظهار النتائج" أو Enter)، فهذا المكوّن لا يعرض زرار تطبيق
 * بنفسه — يُفترض عرضه داخل <form> واحد يجمعه مع باقي حقول الفلتر بالشاشة (مثل حقول التاريخ).
 */
export default function ReportRollupFilter({ accounts, values, onChange }) {
  const { t } = useTranslation();
  const levelAccounts = accounts.filter((a) => a.level === values.level);

  return (
    <>
      <label>
        {t("reports.rollupFilter.levelLabel")}
        <select
          value={values.level}
          onChange={(e) => { onChange("level", Number(e.target.value)); onChange("accountId", ""); }}
        >
          <option value={1}>{t("chartOfAccounts.filters.level1")}</option>
          <option value={2}>{t("chartOfAccounts.filters.level2")}</option>
          <option value={3}>{t("chartOfAccounts.filters.level3")}</option>
          <option value={4}>{t("chartOfAccounts.filters.level4Full")}</option>
        </select>
      </label>
      <label>
        {t("reports.rollupFilter.filterByAccountLabel")}
        <AccountSearchSelect
          accounts={levelAccounts}
          value={values.accountId}
          onChange={(accountId) => onChange("accountId", accountId)}
          allowClear
          clearLabel={t("reports.rollupFilter.clearLabel")}
          placeholder={t("reports.rollupFilter.placeholder")}
        />
      </label>
      {values.accountId && (
        <label className="checkbox-label">
          <input type="checkbox" checked={values.includeDetails} onChange={(e) => onChange("includeDetails", e.target.checked)} />
          {t("reports.rollupFilter.includeDetails")}
        </label>
      )}
      <label>
        {t("chartOfAccounts.filters.searchLabel")}
        <input type="text" value={values.search} onChange={(e) => onChange("search", e.target.value)} placeholder={t("chartOfAccounts.filters.searchPlaceholder")} />
      </label>
    </>
  );
}
