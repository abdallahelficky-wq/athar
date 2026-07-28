import React from "react";

/**
 * شريط تنقّل صغير (eyebrow) أعلى عنوان كل شاشة، مثل "المبيعات › بيانات حقيقية" — يُستبدَل به
 * السلسلة النصية الواحدة القديمة ("X — Y") حتى يكون الفاصل بين الأجزاء عنصراً مُنسَّقاً بلونه
 * الخاص (أخف من لون النص) بدل شرطة عادية بنفس لون ووزن النص المحيط بها.
 */
export default function Breadcrumb({ parts }) {
  return (
    <span className="eyebrow">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="eyebrow-sep">›</span>}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
}
