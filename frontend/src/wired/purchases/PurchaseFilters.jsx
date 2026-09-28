import React from "react";
import { useTranslation } from "react-i18next";
export default function PurchaseFilters({ value, onChange, fields, count, total }) {
 const {t}=useTranslation();
 return <div className="panel"><div className="form-grid">
 {fields.map(field => <label key={field.key}>{t(`purchaseFilters.${field.key}`)}
 {field.options ? <select aria-label={t(`purchaseFilters.${field.key}`)} value={value[field.key]} onChange={e=>onChange({...value,[field.key]:e.target.value})}><option value="">{t("purchaseFilters.all")}</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input aria-label={t(`purchaseFilters.${field.key}`)} type={field.type || "search"} value={value[field.key]} onChange={e=>onChange({...value,[field.key]:e.target.value})} />}
 </label>)}
 </div><div className="form-btn-group"><button className="btn-ghost" onClick={()=>onChange(Object.fromEntries(Object.keys(value).map(k=>[k,""])))}>{t("purchaseFilters.reset")}</button><span aria-live="polite">{t("purchaseFilters.count",{count,total})}</span></div></div>;
}
