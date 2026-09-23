import React from "react";

/**
 * رأس عمود جدول قابل للنقر للترتيب، مع سهم يُبيّن اتجاه الترتيب الحالي — عام بالكامل (لا يعرف شيئاً
 * عن نوع البيانات)، مُعاد استخدامه لاحقاً لأي جدول قائمة آخر قابل للترتيب من جانب الخادم.
 * sortKey غير المُمرَّر (undefined) يجعل العمود غير قابل للترتيب (رأس عادي، بلا زر).
 */
export default function SortableTh({ label, sortKey, sort, onSort, className }) {
  if (!sortKey) return <th className={className}>{label}</th>;
  const active = sort.sortBy === sortKey;
  const nextDir = active && sort.sortDir === "asc" ? "desc" : "asc";
  return (
    <th className={className}>
      <button type="button" className="sortable-th-btn" onClick={() => onSort(sortKey, nextDir)}>
        {label}
        <span className={`sortable-th-arrow ${active ? "sortable-th-arrow-active" : ""}`}>
          {active ? (sort.sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
