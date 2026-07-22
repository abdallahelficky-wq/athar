import React from "react";
import CompanySelector from "../CompanySelector";
import ItemsTab from "./ItemsTab";
import StockInOutTab from "./StockInOutTab";
import IssueTab from "./IssueTab";
import TransferTab from "./TransferTab";
import StockReportTab from "./StockReportTab";

export const INVENTORY_TABS = [
  { id: "items", label: "الأصناف" },
  { id: "inout", label: "إدخال / إخراج" },
  { id: "issue", label: "الصرف المخزني" },
  { id: "transfer", label: "التحويل بين الفروع" },
  { id: "report", label: "تقرير الأرصدة" },
];

export default function InventoryWiredModule({ tab, setTab, companies, companyId, setCompanyId, onCompanyCreated }) {
  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">إدارة المخازن — بيانات حقيقية</span>
        <h2>المخزون</h2>
      </div>
      <CompanySelector companies={companies} companyId={companyId} setCompanyId={setCompanyId} onCompanyCreated={onCompanyCreated} />
      <div className="report-tabs">
        {INVENTORY_TABS.map((t) => <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === "items" && <ItemsTab companyId={companyId} />}
      {tab === "inout" && <StockInOutTab companyId={companyId} />}
      {tab === "issue" && <IssueTab companyId={companyId} />}
      {tab === "transfer" && <TransferTab companyId={companyId} companies={companies} />}
      {tab === "report" && <StockReportTab companyId={companyId} />}
    </div>
  );
}
