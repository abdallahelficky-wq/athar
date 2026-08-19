import React from "react";
import CustomersTab from "./CustomersTab";
import QuotationsTab from "./QuotationsTab";
import InvoicesTab from "./InvoicesTab";
import ReturnsTab from "./ReturnsTab";
import ReceiptsTab from "./ReceiptsTab";
import StationsTab from "./StationsTab";
import SalesReportsTab from "./SalesReportsTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";

export const SALES_TABS = [
  { id: "customers", labelKey: "nav.tabs.customers" },
  { id: "quotations", labelKey: "nav.tabs.quotations" },
  { id: "invoices", labelKey: "nav.tabs.invoices" },
  { id: "returns", labelKey: "nav.tabs.returns" },
  { id: "receipts", labelKey: "nav.tabs.receipts" },
  { id: "stations", labelKey: "nav.tabs.stations" },
  { id: "reports", labelKey: "nav.tabs.reports" },
];

export default function SalesWiredModule({ tab, setTab, companies, companyId, onViewAccount }) {
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["التجارة والمبيعات", "بيانات حقيقية"]} />
        <h2>المبيعات</h2>
      </div>
      <SubTabs tabs={SALES_TABS} active={tab} onChange={setTab} />
      {tab === "customers" && <CustomersTab companyId={companyId} companies={companies} onViewAccount={onViewAccount} />}
      {tab === "quotations" && <QuotationsTab companyId={companyId} companies={companies} />}
      {tab === "invoices" && <InvoicesTab companyId={companyId} companies={companies} />}
      {tab === "returns" && <ReturnsTab companyId={companyId} />}
      {tab === "receipts" && <ReceiptsTab companyId={companyId} />}
      {tab === "stations" && <StationsTab companyId={companyId} />}
      {tab === "reports" && <SalesReportsTab companyId={companyId} />}
    </div>
  );
}
