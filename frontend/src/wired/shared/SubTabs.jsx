import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { NavIcon } from "../../legacy/navIcons";

/**
 * شريط التبويبات الفرعي المُوحَّد لكل المديولات (المبيعات، المشتريات، المخزون، الأصول الثابتة،
 * الحسابات، شئون الموظفين، التقارير، الإعدادات...) — Component واحد بدل تكرار نفس الـ JSX/الأسلوب
 * في كل ملف، حتى ينطبق أي تعديل مستقبلي على الشكل تلقائياً في كل مكان. الأزرار تُمركَز أفقياً
 * دائماً (`.subtabs-track` بحاوية `.subtabs-bar` مُتمركِزة)، وأي محتوى إضافي غير-تبويب (مثل زر
 * الطباعة في شاشة التقارير) يُمرَّر عبر `trailing` ويُثبَّت على الحافة دون كسر توسيط التبويبات نفسها.
 *
 * basePath (اختياري): لو مُمرَّر، كل تبويب يُعرَض كرابط <Link> حقيقي إلى `${basePath}/${tab.id}` —
 * يدعم تلقائياً Ctrl/Cmd+Click والزر الأوسط و"فتح في تبويب جديد" من قائمة الزر اليمين، بخلاف الزر
 * القديم المعتمِد على onClick+state فقط. بلا basePath يبقى السلوك القديم (onChange) كما هو —
 * لتبويبات فرعية داخلية غير مرتبطة بمسار مستقل بعد (كتقارير المبيعات/المشتريات الداخلية).
 */
export default function SubTabs({ tabs, active, onChange, basePath, trailing }) {
  const { t } = useTranslation();
  return (
    <div className="subtabs-bar">
      <div className="subtabs-track">
        {tabs.map((tab) => {
          const className = "subtab" + (active === tab.id ? " active" : "");
          const content = (
            <>
              <span className="subtab-icon"><NavIcon name={tab.id} /></span>
              <span>{tab.labelKey ? t(tab.labelKey) : tab.label}</span>
            </>
          );
          return basePath ? (
            <Link key={tab.id} to={`${basePath}/${tab.id}`} className={className}>{content}</Link>
          ) : (
            <button key={tab.id} type="button" className={className} onClick={() => onChange(tab.id)}>{content}</button>
          );
        })}
      </div>
      {trailing && <div className="subtabs-trailing">{trailing}</div>}
    </div>
  );
}
