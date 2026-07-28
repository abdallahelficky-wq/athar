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
  { id: "customers", label: "العملاء" },
  { id: "quotations", label: "عروض الأسعار" },
  { id: "invoices", label: "فواتير المبيعات" },
  { id: "returns", label: "مردودات المبيعات" },
  { id: "receipts", label: "سندات القبض" },
  { id: "stations", label: "مبيعات المحطات" },
  { id: "reports", label: "التقارير" },
];

export default function SalesWiredModule({ tab, setTab, companies, companyId }) {
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["التجارة والمبيعات", "بيانات حقيقية"]} />
        <h2>المبيعات</h2>
      </div>
      <SubTabs tabs={SALES_TABS} active={tab} onChange={setTab} />
      {tab === "customers" && <CustomersTab companyId={companyId} companies={companies} />}
      {tab === "quotations" && <QuotationsTab companyId={companyId} />}
      {tab === "invoices" && <InvoicesTab companyId={companyId} companies={companies} />}
      {tab === "returns" && <ReturnsTab companyId={companyId} />}
      {tab === "receipts" && <ReceiptsTab companyId={companyId} />}
      {tab === "stations" && <StationsTab companyId={companyId} />}
      {tab === "reports" && <SalesReportsTab companyId={companyId} />}
    </div>
  );
}
