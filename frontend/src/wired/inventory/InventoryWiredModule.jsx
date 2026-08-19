import React from "react";
import { useTranslation } from "react-i18next";
import ItemsTab from "./ItemsTab";
import WarehousesTab from "./WarehousesTab";
import StockInOutTab from "./StockInOutTab";
import IssueTab from "./IssueTab";
import TransferTab from "./TransferTab";
import StockReportTab from "./StockReportTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";

export const INVENTORY_TABS = [
  { id: "items", labelKey: "nav.tabs.items" },
  { id: "warehouses", labelKey: "nav.tabs.warehouses" },
  { id: "inout", labelKey: "nav.tabs.inout" },
  { id: "issue", labelKey: "nav.tabs.issue" },
  { id: "transfer", labelKey: "nav.tabs.transfer" },
  { id: "report", labelKey: "nav.tabs.report" },
];

export default function InventoryWiredModule({ tab, setTab, companies, companyId }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("inventory.breadcrumb"), t("dashboard.breadcrumb.realData")]} />
        <h2>{t("nav.groups.inventory")}</h2>
      </div>
      <SubTabs tabs={INVENTORY_TABS} active={tab} onChange={setTab} />
      {tab === "items" && <ItemsTab companyId={companyId} onNavigateTransfer={() => setTab("transfer")} />}
      {tab === "warehouses" && <WarehousesTab companyId={companyId} />}
      {tab === "inout" && <StockInOutTab companyId={companyId} />}
      {tab === "issue" && <IssueTab companyId={companyId} />}
      {tab === "transfer" && <TransferTab companyId={companyId} companies={companies} />}
      {tab === "report" && <StockReportTab companyId={companyId} />}
    </div>
  );
}
