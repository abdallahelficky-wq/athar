import React from "react";
import { NavIcon } from "../../legacy/navIcons";

/**
 * شريط التبويبات الفرعي المُوحَّد لكل المديولات (المبيعات، المشتريات، المخزون، الأصول الثابتة،
 * الحسابات، شئون الموظفين، التقارير، الإعدادات...) — Component واحد بدل تكرار نفس الـ JSX/الأسلوب
 * في كل ملف، حتى ينطبق أي تعديل مستقبلي على الشكل تلقائياً في كل مكان. الأزرار تُمركَز أفقياً
 * دائماً (`.subtabs-track` بحاوية `.subtabs-bar` مُتمركِزة)، وأي محتوى إضافي غير-تبويب (مثل زر
 * الطباعة في شاشة التقارير) يُمرَّر عبر `trailing` ويُثبَّت على الحافة دون كسر توسيط التبويبات نفسها.
 */
export default function SubTabs({ tabs, active, onChange, trailing }) {
  return (
    <div className="subtabs-bar">
      <div className="subtabs-track">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={"subtab" + (active === t.id ? " active" : "")}
            onClick={() => onChange(t.id)}
          >
            <span className="subtab-icon"><NavIcon name={t.id} /></span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {trailing && <div className="subtabs-trailing">{trailing}</div>}
    </div>
  );
}
