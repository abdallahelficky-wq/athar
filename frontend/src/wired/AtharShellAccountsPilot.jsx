import React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import CompanySwitcher from "./shared/CompanySwitcher";
import UnsavedChangesBlocker from "./shared/UnsavedChangesBlocker";
import { useModuleTab } from "./shared/useModuleTab";
import { usePilotShell } from "./shared/usePilotShell";
import { WorkflowSteps } from "../ui/ledger/LedgerComponents";
import { ACCOUNTS_TABS } from "./AccountsGroupModule";
import JournalModule from "./JournalModule";
import ChartOfAccountsModule from "./ChartOfAccountsModule";
import AccountLedgerModule from "./AccountLedgerModule";
import DepartmentsTab from "./DepartmentsTab";
import AtharShell from "../ui/ledger/AtharShell";

/**
 * امتداد ثالث للمعاينة التجريبية (بعد لوحة القيادة والمبيعات): يُغلِّف وحدة الحسابات الحقيقية
 * بهيكل أثر الجديد على مسار مستقل (/ui-preview/accounts/:tab)، بلا أي تعديل في أي من المكوّنات
 * الأربعة المُعاد استخدامها (JournalModule، ChartOfAccountsModule, AccountLedgerModule،
 * DepartmentsTab) — بما فيها شجرة الحسابات الهرمية نفسها: هي فعلياً جدول مسطّح بإزاحة حسب
 * المستوى + طي/فتح داخلي (لا Tree-view منفصل)، فتُستخدَم كما هي دون أي تمثيل بصري جديد.
 *
 * تبويب "الزكاة" (ACCOUNTS_TABS الحقيقي يتضمنه) مُستبعَد عمداً من هذا الامتداد: يعرض بيانات
 * تجريبية قديمة (seedEntries/seedSales) وليس بيانات API حقيقية، بخلاف كل شاشة أخرى في التجربة —
 * قرار صريح من المستخدم، يمكن إضافته لاحقاً بعد ربطه ببيانات حقيقية.
 */
const WORKFLOW_STEP_ICONS = {
  journal: "journal",
  chartOfAccounts: "chartOfAccounts",
  ledger: "ledger",
  departments: "departments",
};

const PILOT_ACCOUNTS_TABS = ACCOUNTS_TABS.filter((tabDef) => tabDef.id !== "zakat");

export default function AtharShellAccountsPilot() {
  const { t, real, activeCompany, modules, handleNavigate, handleLogout, readOnlyBanner } = usePilotShell("accounts");
  const [tab, setTab] = useModuleTab("/ui-preview/accounts", PILOT_ACCOUNTS_TABS);
  // نفس آلية الدخول المباشر لحساب معيّن عبر ?accountId= الموجودة في AccountsGroupModule.jsx الحقيقي.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingLedgerAccountId = searchParams.get("accountId");

  const steps = PILOT_ACCOUNTS_TABS.map((tabDef) => ({ id: tabDef.id, label: t(tabDef.labelKey), icon: WORKFLOW_STEP_ICONS[tabDef.id] }));

  return (
    <>
      <UnsavedChangesBlocker />
      <AtharShell
        modules={modules}
        activeModuleId="accounts"
        onNavigate={handleNavigate}
        companyName={activeCompany?.shortName || activeCompany?.name}
        companyControl={<CompanySwitcher companies={real.companies} companyId={real.companyId} setCompanyId={real.setCompanyId} />}
        modeLabel={t("ledgerUi.pilotBadge")}
        onLogout={handleLogout}
        warningBanner={readOnlyBanner}
      >
        <WorkflowSteps steps={steps} activeId={tab} onChange={setTab} />
        {tab === "journal" && <JournalModule companies={real.companies} companyId={real.companyId} />}
        {tab === "chartOfAccounts" && <ChartOfAccountsModule companies={real.companies} companyId={real.companyId} />}
        {tab === "ledger" && (
          <AccountLedgerModule
            companies={real.companies} companyId={real.companyId}
            initialAccountId={pendingLedgerAccountId}
            onConsumeInitialAccountId={() => setSearchParams({}, { replace: true })}
          />
        )}
        {tab === "departments" && <DepartmentsTab companyId={real.companyId} />}
      </AtharShell>
    </>
  );
}
