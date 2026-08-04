import React from "react";
import AccountSearchSelect from "./AccountSearchSelect";

/**
 * منطق فلترة مشترك لكل التقارير المالية (ميزان المراجعة، قائمة الدخل، المركز المالي، كشف حساب
 * الأستاذ، وأي تقرير مالي مستقبلي): اختيار مستوى التجميع (1-4)، فلترة بفرع/حساب معيّن من ذلك
 * المستوى، وتبديل "بالتفاصيل/بدون تفاصيل" يظهر فقط بعد اختيار فرع محدَّد. القيم الثلاث تُمرَّر
 * مباشرة كـ query params لأي endpoint تقرير يدعم rollupParams في الخادم (level/accountId/
 * includeDetails/search) — نفس العقد بلا أي منطق مكرَّر لكل شاشة تقرير.
 */
export default function ReportRollupFilter({ accounts, level, onLevelChange, accountId, onAccountChange, includeDetails, onIncludeDetailsChange, search, onSearchChange }) {
  const levelAccounts = accounts.filter((a) => a.level === level);

  return (
    <div className="filter-bar report-rollup-filter">
      <label>
        المستوى
        <select
          value={level}
          onChange={(e) => { onLevelChange(Number(e.target.value)); onAccountChange(""); }}
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
          value={accountId}
          onChange={onAccountChange}
          allowClear
          clearLabel="— كل حسابات هذا المستوى —"
          placeholder="ابحث عن حساب أو مجموعة..."
        />
      </label>
      {accountId && (
        <label className="checkbox-label">
          <input type="checkbox" checked={includeDetails} onChange={(e) => onIncludeDetailsChange(e.target.checked)} />
          عرض بالتفاصيل (كل حسابات الترحيل تحت هذه المجموعة)
        </label>
      )}
      <label>
        بحث بالاسم أو الكود
        <input type="text" value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="بحث..." />
      </label>
    </div>
  );
}
