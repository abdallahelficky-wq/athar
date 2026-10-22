import React from "react";
import { itemNameParts } from "./itemDisplayName";

/**
 * اسم صنف في القوائم وبطاقة الصنف: الاسم المعروض بلغة الواجهة (getItemDisplayName) والآخر سطراً ثانوياً صغيراً — في الإنجليزية
 * الاسم العربي، وفي العربية nameEn كما اليوم. extra: سطر إضافي اختياري (التصنيف في قائمة الأصناف).
 */
export default function ItemName({ item, language, as: Primary = "strong", secondaryAs: Secondary = "small", extra = null }) {
  const { primary, secondary } = itemNameParts(item, language);
  return (
    <>
      <Primary>{primary}</Primary>
      {secondary && <Secondary dir={secondary.dir}>{secondary.text}</Secondary>}
      {extra}
    </>
  );
}
