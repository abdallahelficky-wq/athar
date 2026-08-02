import React from "react";
import ItemsTab from "./ItemsTab";
import StockInOutTab from "./StockInOutTab";
import IssueTab from "./IssueTab";
import TransferTab from "./TransferTab";
import StockReportTab from "./StockReportTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";

export const INVENTORY_TABS = [
  { id: "items", label: "الأصناف" },
  { id: "inout", label: "إدخال / إخراج" },
  { id: "issue", label: "الصرف المخزني" },
  { id: "transfer", label: "التحويل بين الفروع" },
  { id: "report", label: "تقرير الأرصدة" },
];

export default function InventoryWiredModule({ tab, setTab, companies, companyId }) {
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["إدارة المخازن", "بيانات حقيقية"]} />
        <h2>المخزون</h2>
      </div>
      <SubTabs tabs={INVENTORY_TABS} active={tab} onChange={setTab} />
      {tab === "items" && <ItemsTab companyId={companyId} onNavigateTransfer={() => setTab("transfer")} />}
      {tab === "inout" && <StockInOutTab companyId={companyId} />}
      {tab === "issue" && <IssueTab companyId={companyId} />}
      {tab === "transfer" && <TransferTab companyId={companyId} companies={companies} />}
      {tab === "report" && <StockReportTab companyId={companyId} />}
    </div>
  );
}
