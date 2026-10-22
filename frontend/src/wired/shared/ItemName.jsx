import React from "react";
import { getItemDisplayName, getItemSecondaryName, itemSecondaryDir } from "./itemDisplayName";

/**
 * اسم صنف في القوائم وبطاقة الصنف: الاسم المعروض بلغة الواجهة (getItemDisplayName) والآخر سطراً ثانوياً صغيراً — في الإنجليزية
 * الاسم العربي، وفي العربية nameEn كما اليوم. extra: سطر إضافي اختياري (التصنيف في قائمة الأصناف).
 */
export default function ItemName({ item, language, as: Primary = "strong", secondaryAs: Secondary = "small", extra = null }) {
  const secondary = getItemSecondaryName(item, language);
  return (
    <>
      <Primary>{getItemDisplayName(item, language)}</Primary>
      {secondary && <Secondary dir={itemSecondaryDir(language)}>{secondary}</Secondary>}
      {extra}
    </>
  );
}
