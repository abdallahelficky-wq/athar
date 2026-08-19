import React from "react";
import { useTranslation } from "react-i18next";
import { NavIcon } from "../../legacy/navIcons";

/**
 * شريط التبويبات الفرعي المُوحَّد لكل المديولات (المبيعات، المشتريات، المخزون، الأصول الثابتة،
 * الحسابات، شئون الموظفين، التقارير، الإعدادات...) — Component واحد بدل تكرار نفس الـ JSX/الأسلوب
 * في كل ملف، حتى ينطبق أي تعديل مستقبلي على الشكل تلقائياً في كل مكان. الأزرار تُمركَز أفقياً
 * دائماً (`.subtabs-track` بحاوية `.subtabs-bar` مُتمركِزة)، وأي محتوى إضافي غير-تبويب (مثل زر
 * الطباعة في شاشة التقارير) يُمرَّر عبر `trailing` ويُثبَّت على الحافة دون كسر توسيط التبويبات نفسها.
 */
export default function SubTabs({ tabs, active, onChange, trailing }) {
  const { t } = useTranslation();
  return (
    <div className="subtabs-bar">
      <div className="subtabs-track">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={"subtab" + (active === tab.id ? " active" : "")}
            onClick={() => onChange(tab.id)}
          >
            <span className="subtab-icon"><NavIcon name={tab.id} /></span>
            <span>{tab.labelKey ? t(tab.labelKey) : tab.label}</span>
          </button>
        ))}
      </div>
      {trailing && <div className="subtabs-trailing">{trailing}</div>}
    </div>
  );
}
