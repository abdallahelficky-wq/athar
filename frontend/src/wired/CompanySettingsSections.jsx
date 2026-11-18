import React from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import CompanyDataPanel from "./CompanyDataPanel";

/** أقسام من إعدادات الشركة النشطة تُعرَض داخل موديولها (الحسابات، المتجر الإلكتروني، ورديات المحطات) بدل صفحة
 * الإعدادات — نفس CompanyDataPanel ونفس الحفظ (PATCH /companies/:id بحقول القسم وحده)، على الشركة النشطة فقط. */
export default function CompanySettingsSections({ companyId, only, extraSections, links }) {
  const { t } = useTranslation();
  const { realCompanies = [], reloadRealCompanies, companiesLoading } = useOutletContext() || {};
  const company = realCompanies.find((c) => c.id === companyId);
  if (!company) return companiesLoading ? null : <p className="empty">{t("nav.noCompanySelected")}</p>;
  return (
    <CompanyDataPanel
      key={`${company.id}:${only.join(",")}`}
      company={company}
      onChanged={reloadRealCompanies}
      only={only}
      extraSections={extraSections}
      links={links}
    />
  );
}
