import React from "react";
import SuppliersTab from "./SuppliersTab";
import PurchaseInvoicesTab from "./PurchaseInvoicesTab";
import PurchaseReturnsTab from "./PurchaseReturnsTab";
import PurchaseReportsTab from "./PurchaseReportsTab";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";

export const PURCHASE_TABS = [
  { id: "suppliers", label: "الموردون" },
  { id: "invoices", label: "فواتير المشتريات" },
  { id: "returns", label: "مردودات المشتريات" },
  { id: "reports", label: "التقارير" },
];

export default function PurchasesWiredModule({ tab, setTab, companies, companyId }) {
  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["التجارة والمشتريات", "بيانات حقيقية"]} />
        <h2>المشتريات</h2>
      </div>
      <SubTabs tabs={PURCHASE_TABS} active={tab} onChange={setTab} />
      {tab === "suppliers" && <SuppliersTab companyId={companyId} companies={companies} />}
      {tab === "invoices" && <PurchaseInvoicesTab companyId={companyId} companies={companies} />}
      {tab === "returns" && <PurchaseReturnsTab companyId={companyId} />}
      {tab === "reports" && <PurchaseReportsTab companyId={companyId} />}
    </div>
  );
}
