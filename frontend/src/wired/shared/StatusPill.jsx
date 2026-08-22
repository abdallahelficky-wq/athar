import React from "react";

/**
 * حالة ملوَّنة عامة قابلة لإعادة الاستخدام — لا تحمل أي منطق تصنيف نصوص بحد ذاتها (لا تعرف معنى
 * "مرحّل"/"مسودة"/"متأخر السداد"...)، فقط تُترجِم tone دلالياً بسيطاً (success/warning/danger/
 * neutral/info) للون موحّد؛ المستدعي هو من يقرر النص (المترجَم مسبقاً عبر i18n) والـ tone المناسب
 * لحالته. مستقل عمداً عن .status-pill/.status-badge المستخدَمين حالياً في شاشات الفواتير/القيود
 * (كل منهما بمنطق ألوان خاص به) — لا يستبدلهما، بل خيار جديد لأي مكان يتبنّاه لاحقاً.
 */
export default function StatusPill({ tone = "neutral", children }) {
  return <span className={`shared-status-pill shared-status-pill-${tone}`}>{children}</span>;
}
