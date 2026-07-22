import React from "react";
import CompanySelector from "../CompanySelector";
import SuppliersTab from "./SuppliersTab";
import PurchaseInvoicesTab from "./PurchaseInvoicesTab";
import PurchaseReturnsTab from "./PurchaseReturnsTab";
import PurchaseReportsTab from "./PurchaseReportsTab";

export const PURCHASE_TABS = [
  { id: "suppliers", label: "الموردون" },
  { id: "invoices", label: "فواتير المشتريات" },
  { id: "returns", label: "مردودات المشتريات" },
  { id: "reports", label: "التقارير" },
];

export default function PurchasesWiredModule({ tab, setTab, companies, companyId, setCompanyId, onCompanyCreated }) {
  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">التجارة والمشتريات — بيانات حقيقية</span>
        <h2>المشتريات</h2>
      </div>
      <CompanySelector companies={companies} companyId={companyId} setCompanyId={setCompanyId} onCompanyCreated={onCompanyCreated} />
      <div className="report-tabs">
        {PURCHASE_TABS.map((t) => <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === "suppliers" && <SuppliersTab companyId={companyId} />}
      {tab === "invoices" && <PurchaseInvoicesTab companyId={companyId} />}
      {tab === "returns" && <PurchaseReturnsTab companyId={companyId} />}
      {tab === "reports" && <PurchaseReportsTab companyId={companyId} />}
    </div>
  );
}
