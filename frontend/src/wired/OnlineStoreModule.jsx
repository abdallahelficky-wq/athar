import React from "react";
import { useTranslation } from "react-i18next";
import SubTabs from "./shared/SubTabs";
import { useModuleTab } from "./shared/useModuleTab";
import StoreOrdersTab from "./sales/StoreOrdersTab";
import CompanySettingsSections from "./CompanySettingsSections";

export const ONLINE_STORE_TABS = [
  { id: "storeOrders", labelKey: "nav.tabs.storeOrders" },
  { id: "storeGeneral", labelKey: "nav.tabs.storeGeneral" },
  { id: "storeAppearance", labelKey: "nav.tabs.storeAppearance" },
  { id: "storeShipping", labelKey: "nav.tabs.storeShipping" },
  { id: "storePayment", labelKey: "nav.tabs.storePayment" },
  { id: "storeMarketing", labelKey: "nav.tabs.storeMarketing" },
  { id: "storePolicies", labelKey: "nav.tabs.storePolicies" },
];

/** المتجر الإلكتروني كموديول في القائمة الرئيسية: الطلبات، ثم كل قسم من إعدادات المتجر في تبويبه وله حفظه */
export default function OnlineStoreModule({ companyId }) {
  const { t } = useTranslation();
  const [tab] = useModuleTab("/onlineStore", ONLINE_STORE_TABS);
  return (
    <div>
      <div className="section-title"><h2>{t("nav.groups.onlineStore")}</h2></div>
      <SubTabs tabs={ONLINE_STORE_TABS} active={tab} basePath="/onlineStore" />
      {tab === "storeOrders"
        ? <StoreOrdersTab companyId={companyId} />
        : <CompanySettingsSections key={tab} companyId={companyId} only={[tab]} />}
    </div>
  );
}
