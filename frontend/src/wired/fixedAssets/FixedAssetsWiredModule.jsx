import React from "react";
import CompanySelector from "../CompanySelector";
import AssetRegisterTab from "./AssetRegisterTab";
import DepreciationTab from "./DepreciationTab";
import DisposalTab from "./DisposalTab";
import AssetReportsTab from "./AssetReportsTab";

export const FIXED_ASSETS_TABS = [
  { id: "register", label: "سجل الأصول" },
  { id: "depreciation", label: "الإهلاك الشهري" },
  { id: "disposal", label: "الاستبعاد/البيع" },
  { id: "reports", label: "التقارير" },
];

export default function FixedAssetsWiredModule({ tab, setTab, companies, companyId, setCompanyId, onCompanyCreated }) {
  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">الأصول الثابتة — بيانات حقيقية</span>
        <h2>الأصول الثابتة</h2>
      </div>
      <CompanySelector companies={companies} companyId={companyId} setCompanyId={setCompanyId} onCompanyCreated={onCompanyCreated} />
      <div className="report-tabs">
        {FIXED_ASSETS_TABS.map((t) => <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === "register" && <AssetRegisterTab companyId={companyId} />}
      {tab === "depreciation" && <DepreciationTab companyId={companyId} />}
      {tab === "disposal" && <DisposalTab companyId={companyId} />}
      {tab === "reports" && <AssetReportsTab companyId={companyId} />}
    </div>
  );
}
