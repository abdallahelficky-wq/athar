import React from "react";
import AssetRegisterTab from "./AssetRegisterTab";
import DepreciationTab from "./DepreciationTab";
import DisposalTab from "./DisposalTab";
import AssetReportsTab from "./AssetReportsTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";

export const FIXED_ASSETS_TABS = [
  { id: "register", label: "سجل الأصول" },
  { id: "depreciation", label: "الإهلاك الشهري" },
  { id: "disposal", label: "الاستبعاد/البيع" },
  { id: "reports", label: "التقارير" },
];

export default function FixedAssetsWiredModule({ tab, setTab, companies, companyId }) {
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["الأصول الثابتة", "بيانات حقيقية"]} />
        <h2>الأصول الثابتة</h2>
      </div>
      <SubTabs tabs={FIXED_ASSETS_TABS} active={tab} onChange={setTab} />
      {tab === "register" && <AssetRegisterTab companyId={companyId} />}
      {tab === "depreciation" && <DepreciationTab companyId={companyId} />}
      {tab === "disposal" && <DisposalTab companyId={companyId} />}
      {tab === "reports" && <AssetReportsTab companyId={companyId} />}
    </div>
  );
}
