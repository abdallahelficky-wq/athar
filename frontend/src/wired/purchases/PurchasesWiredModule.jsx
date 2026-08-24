import React from "react";
import { useTranslation } from "react-i18next";
import SuppliersTab from "./SuppliersTab";
import PurchaseInvoicesTab from "./PurchaseInvoicesTab";
import PurchaseReturnsTab from "./PurchaseReturnsTab";
import PurchaseReportsTab from "./PurchaseReportsTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";
import { useModuleTab } from "../shared/useModuleTab";

export const PURCHASE_TABS = [
  { id: "suppliers", labelKey: "nav.tabs.suppliers" },
  { id: "invoices", labelKey: "nav.tabs.purchaseInvoices" },
  { id: "returns", labelKey: "nav.tabs.purchaseReturns" },
  { id: "reports", labelKey: "nav.tabs.reports" },
];

export default function PurchasesWiredModule({ companies, companyId }) {
  const { t } = useTranslation();
  const [tab] = useModuleTab("/purchases", PURCHASE_TABS);
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("nav.groups.purchases"), t("dashboard.breadcrumb.realData")]} />
        <h2>{t("nav.groups.purchases")}</h2>
      </div>
      <SubTabs tabs={PURCHASE_TABS} active={tab} basePath="/purchases" />
      {tab === "suppliers" && <SuppliersTab companyId={companyId} companies={companies} />}
      {tab === "invoices" && <PurchaseInvoicesTab companyId={companyId} companies={companies} />}
      {tab === "returns" && <PurchaseReturnsTab companyId={companyId} companies={companies} />}
      {tab === "reports" && <PurchaseReportsTab companyId={companyId} />}
    </div>
  );
}
