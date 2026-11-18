import React from "react";
import { useTranslation } from "react-i18next";
import { useModuleTab } from "./shared/useModuleTab";
import LeasesTab from "./leases/LeasesTab";

export const LEASES_TABS = [{ id: "leaseContracts", labelKey: "nav.tabs.leaseContracts" }];

/**
 * عقود الإيجار كموديول في القائمة الرئيسية — كانت قسماً داخل «بيانات الشركات» في الإعدادات. المحتوى شاشة الإيجارات الكاملة
 * (التقويم، العقود وجداول دفعاتها، الإطفاء الشهري) على الشركة النشطة — LeasesTab.
 */
export default function LeasesModule({ companyId }) {
  const { t } = useTranslation();
  useModuleTab("/leases", LEASES_TABS);
  return (
    <div key={companyId}>
      <div className="section-title"><h2>{t("nav.groups.leases")}</h2></div>
      {companyId
        ? <LeasesTab companyId={companyId} />
        : <p className="empty">{t("nav.noCompanySelected")}</p>}
    </div>
  );
}
