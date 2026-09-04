import React from "react";
import { useTranslation } from "react-i18next";
import CompanySwitcher from "./shared/CompanySwitcher";
import UnsavedChangesBlocker from "./shared/UnsavedChangesBlocker";
import { useModuleTab } from "./shared/useModuleTab";
import { usePilotShell } from "./shared/usePilotShell";
import { WorkflowSteps } from "../ui/ledger/LedgerComponents";
import { SALES_TABS } from "./sales/SalesWiredModule";
import CustomersTab from "./sales/CustomersTab";
import QuotationsTab from "./sales/QuotationsTab";
import InvoicesTab from "./sales/InvoicesTab";
import ReturnsTab from "./sales/ReturnsTab";
import ReceiptsTab from "./sales/ReceiptsTab";
import StationsTab from "./sales/StationsTab";
import SalesReportsTab from "./sales/SalesReportsTab";
import SalesSettingsTab from "./sales/SalesSettingsTab";
import AtharShell from "../ui/ledger/AtharShell";

/**
 * امتداد ثانٍ للمعاينة التجريبية (بعد لوحة القيادة): يُغلِّف وحدة المبيعات الحقيقية بهيكل أثر
 * الجديد على مسار مستقل (/ui-preview/sales/:tab)، بلا أي تعديل في SalesWiredModule.jsx نفسه ولا
 * في أي من مكوّنات التبويبات الثمانية (InvoicesTab، CustomersTab، ...) — يُعاد استخدامها هنا كما
 * هي حرفياً، بنفس props التي يستخدمها SalesRoute الحقيقي في App.jsx.
 *
 * حالة التبويب الفعّال تُقرأ من نفس useModuleTab المستخدَم في الوحدة الحقيقية (لا حالة منفصلة)،
 * فقط بمسار أساس مختلف (/ui-preview/sales بدل /sales) — التنقّل بين التبويبات هو تنقّل react-router
 * فعلي، فيمر عبر نفس حارس "مسودة غير محفوظة" (UnsavedChangesBlocker) تماماً كما في الوحدة الحقيقية.
 *
 * شريط التبويبات الأفقي القديم (SubTabs) استُبدل بمكوّن WorkflowSteps من حزمة التصميم، بعد تمديده
 * (WORKFLOW_STEP_ICONS + خاصية step.icon الجديدة) ليعرض أيقونة SVG inline لكل تبويب بنفس أسلوب
 * أيقونات src/ui/ledger/Icon.jsx — لا رجوع لأيقونات SubTabs القديمة (NavIcon)، بل أيقونات جديدة
 * بنفس روح الحزمة نفسها.
 */
const WORKFLOW_STEP_ICONS = {
  invoices: "invoices",
  customers: "customers",
  quotations: "quotations",
  returns: "returns",
  receipts: "receipts",
  stations: "stations",
  reports: "reports",
  settings: "settings",
};

export default function AtharShellSalesPilot() {
  const { t, real, activeCompany, modules, handleNavigate, handleLogout, readOnlyBanner } = usePilotShell("sales");
  const [tab, setTab] = useModuleTab("/ui-preview/sales", SALES_TABS);

  const steps = SALES_TABS.map((tabDef) => ({ id: tabDef.id, label: t(tabDef.labelKey), icon: WORKFLOW_STEP_ICONS[tabDef.id] }));

  return (
    <>
      <UnsavedChangesBlocker />
      <AtharShell
        modules={modules}
        activeModuleId="sales"
        onNavigate={handleNavigate}
        companyName={activeCompany?.shortName || activeCompany?.name}
        companyControl={<CompanySwitcher companies={real.companies} companyId={real.companyId} setCompanyId={real.setCompanyId} />}
        modeLabel={t("ledgerUi.pilotBadge")}
        onLogout={handleLogout}
        warningBanner={readOnlyBanner}
      >
        <WorkflowSteps steps={steps} activeId={tab} onChange={setTab} />
        {tab === "customers" && <CustomersTab companyId={real.companyId} companies={real.companies} />}
        {tab === "quotations" && <QuotationsTab companyId={real.companyId} companies={real.companies} />}
        {tab === "invoices" && <InvoicesTab companyId={real.companyId} companies={real.companies} />}
        {tab === "returns" && <ReturnsTab companyId={real.companyId} companies={real.companies} />}
        {tab === "receipts" && <ReceiptsTab companyId={real.companyId} companies={real.companies} />}
        {tab === "stations" && <StationsTab companyId={real.companyId} />}
        {tab === "reports" && <SalesReportsTab companyId={real.companyId} />}
        {tab === "settings" && <SalesSettingsTab companyId={real.companyId} companies={real.companies} reloadCompanies={real.reload} />}
      </AtharShell>
    </>
  );
}
