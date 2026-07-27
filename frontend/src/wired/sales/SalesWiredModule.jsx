import React from "react";
import CompanySelector from "../CompanySelector";
import CustomersTab from "./CustomersTab";
import QuotationsTab from "./QuotationsTab";
import InvoicesTab from "./InvoicesTab";
import ReturnsTab from "./ReturnsTab";
import ReceiptsTab from "./ReceiptsTab";
import StationsTab from "./StationsTab";
import SalesReportsTab from "./SalesReportsTab";

export const SALES_TABS = [
  { id: "customers", label: "العملاء" },
  { id: "quotations", label: "عروض الأسعار" },
  { id: "invoices", label: "فواتير المبيعات" },
  { id: "returns", label: "مردودات المبيعات" },
  { id: "receipts", label: "سندات القبض" },
  { id: "stations", label: "مبيعات المحطات" },
  { id: "reports", label: "التقارير" },
];

export default function SalesWiredModule({ tab, setTab, companies, companyId, setCompanyId, onCompanyCreated }) {
  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">التجارة والمبيعات — بيانات حقيقية</span>
        <h2>المبيعات</h2>
      </div>
      <CompanySelector companies={companies} companyId={companyId} setCompanyId={setCompanyId} onCompanyCreated={onCompanyCreated} />
      <div className="report-tabs">
        {SALES_TABS.map((t) => <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
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
