import React from "react";
import { useTranslation } from "react-i18next";
import AssetRegisterTab from "./AssetRegisterTab";
import DepreciationTab from "./DepreciationTab";
import DisposalTab from "./DisposalTab";
import AssetReportsTab from "./AssetReportsTab";
import AssetCategoriesSettingsTab from "./AssetCategoriesSettingsTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";

export const FIXED_ASSETS_TABS = [
  { id: "register", labelKey: "nav.tabs.register" },
  { id: "depreciation", labelKey: "nav.tabs.depreciation" },
  { id: "disposal", labelKey: "nav.tabs.disposal" },
  { id: "reports", labelKey: "nav.tabs.reports" },
  { id: "categories", labelKey: "nav.tabs.categories" },
];

export default function FixedAssetsWiredModule({ tab, setTab, companies, companyId }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("fixedAssets.breadcrumb"), t("dashboard.breadcrumb.realData")]} />
        <h2>{t("nav.groups.fixedAssets")}</h2>
      </div>
      <SubTabs tabs={FIXED_ASSETS_TABS} active={tab} onChange={setTab} />
      {tab === "register" && <AssetRegisterTab companyId={companyId} companies={companies} />}
      {tab === "depreciation" && <DepreciationTab companyId={companyId} companies={companies} />}
      {tab === "disposal" && <DisposalTab companyId={companyId} companies={companies} />}
      {tab === "reports" && <AssetReportsTab companyId={companyId} />}
      {tab === "categories" && <AssetCategoriesSettingsTab companyId={companyId} />}
    </div>
  );
}
