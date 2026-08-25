import React from "react";
import { useTranslation } from "react-i18next";
import CustomersTab from "./CustomersTab";
import QuotationsTab from "./QuotationsTab";
import InvoicesTab from "./InvoicesTab";
import ReturnsTab from "./ReturnsTab";
import ReceiptsTab from "./ReceiptsTab";
import StationsTab from "./StationsTab";
import SalesReportsTab from "./SalesReportsTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";
import { useModuleTab } from "../shared/useModuleTab";

export const SALES_TABS = [
  { id: "invoices", labelKey: "nav.tabs.invoices" },
  { id: "customers", labelKey: "nav.tabs.customers" },
  { id: "quotations", labelKey: "nav.tabs.quotations" },
  { id: "returns", labelKey: "nav.tabs.returns" },
  { id: "receipts", labelKey: "nav.tabs.receipts" },
  { id: "stations", labelKey: "nav.tabs.stations" },
  { id: "reports", labelKey: "nav.tabs.reports" },
];

export default function SalesWiredModule({ companies, companyId }) {
  const { t } = useTranslation();
  const [tab] = useModuleTab("/sales", SALES_TABS);
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("nav.groups.sales"), t("dashboard.breadcrumb.realData")]} />
        <h2>{t("nav.groups.sales")}</h2>
      </div>
      <SubTabs tabs={SALES_TABS} active={tab} basePath="/sales" />
      {tab === "customers" && <CustomersTab companyId={companyId} companies={companies} />}
      {tab === "quotations" && <QuotationsTab companyId={companyId} companies={companies} />}
      {tab === "invoices" && <InvoicesTab companyId={companyId} companies={companies} />}
      {tab === "returns" && <ReturnsTab companyId={companyId} companies={companies} />}
      {tab === "receipts" && <ReceiptsTab companyId={companyId} companies={companies} />}
      {tab === "stations" && <StationsTab companyId={companyId} />}
      {tab === "reports" && <SalesReportsTab companyId={companyId} />}
    </div>
  );
}
