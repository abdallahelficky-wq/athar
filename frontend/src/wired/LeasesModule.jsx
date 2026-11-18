import React from "react";
import { useTranslation } from "react-i18next";
import { useModuleTab } from "./shared/useModuleTab";
import LeaseContractsPanel from "./LeaseContractsPanel";

export const LEASES_TABS = [{ id: "leaseContracts", labelKey: "nav.tabs.leaseContracts" }];

/** عقود الإيجار كموديول في القائمة الرئيسية — كانت قسماً داخل «بيانات الشركات» في الإعدادات. نفس اللوحة ونفس الـ API، على الشركة النشطة. */
export default function LeasesModule({ companyId }) {
  const { t } = useTranslation();
  useModuleTab("/leases", LEASES_TABS);
  return (
    <div key={companyId}>
      <div className="section-title"><h2>{t("nav.groups.leases")}</h2></div>
      {companyId
        ? <div className="panel form-panel leases-module-panel"><LeaseContractsPanel companyId={companyId} /></div>
        : <p className="empty">{t("nav.noCompanySelected")}</p>}
    </div>
  );
}
