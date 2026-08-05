import React from "react";
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
  const levelAccounts = accounts.filter((a) => a.level === values.level);

  return (
    <>
      <label>
        المستوى
        <select
          value={values.level}
          onChange={(e) => { onChange("level", Number(e.target.value)); onChange("accountId", ""); }}
        >
          <option value={1}>المستوى 1</option>
          <option value={2}>المستوى 2</option>
          <option value={3}>المستوى 3</option>
          <option value={4}>المستوى 4 (تفصيلي بالكامل)</option>
        </select>
      </label>
      <label>
        فلترة بحساب/مجموعة معيّنة
        <AccountSearchSelect
          accounts={levelAccounts}
          value={values.accountId}
          onChange={(accountId) => onChange("accountId", accountId)}
          allowClear
          clearLabel="— كل حسابات هذا المستوى —"
          placeholder="ابحث عن حساب أو مجموعة..."
        />
      </label>
      {values.accountId && (
        <label className="checkbox-label">
          <input type="checkbox" checked={values.includeDetails} onChange={(e) => onChange("includeDetails", e.target.checked)} />
          عرض بالتفاصيل (كل حسابات الترحيل تحت هذه المجموعة)
        </label>
      )}
      <label>
        بحث بالاسم أو الكود
        <input type="text" value={values.search} onChange={(e) => onChange("search", e.target.value)} placeholder="بحث..." />
      </label>
    </>
  );
}
