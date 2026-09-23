import React from "react";
import { useTranslation } from "react-i18next";
import { taxCategory, exemptionCodes } from "./itemDefaults";
export default function TaxCategoryFields({ value, onChange, disabled = false }) {
 const { t } = useTranslation();
 const category = taxCategory(value);
 return <>
  <label>{t("itemTax.category")}<select disabled={disabled} value={category} onChange={(e) => onChange({ taxCategoryCode: e.target.value, vatApplicable: e.target.value === "S", taxExemptionReasonCode: null, taxExemptionReason: null })}>
   {["S", "Z", "E", ...(category === "O" ? ["O"] : [])].map((code) => <option key={code} value={code}>{t(`itemTax.${code}`)}</option>)}
  </select></label>
  {exemptionCodes[category] && <label>{t("itemTax.reason")}<select disabled={disabled} value={value.taxExemptionReasonCode || ""} onChange={(e) => onChange({ taxExemptionReasonCode: e.target.value || null, taxExemptionReason: e.target.value ? t(`itemTax.reasons.${e.target.value}`, { lng: "ar" }) : null })}>
   <option value="">{t("itemTax.chooseReason")}</option>
   {exemptionCodes[category].map((code) => <option key={code} value={code}>{t(`itemTax.reasons.${code}`)}</option>)}
  </select></label>}
 </>;
}
