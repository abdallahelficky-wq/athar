import React from "react";
import { useSearchParams } from "react-router-dom";
import JournalModule from "./JournalModule";
import ChartOfAccountsModule from "./ChartOfAccountsModule";
import AccountLedgerModule from "./AccountLedgerModule";
import DepartmentsTab from "./DepartmentsTab";
import { ZakatModule } from "../legacy/zakat";
import SubTabs from "./shared/SubTabs";
import { useModuleTab } from "./shared/useModuleTab";

export const ACCOUNTS_TABS = [
  { id: "journal", labelKey: "nav.tabs.journal" },
  { id: "chartOfAccounts", labelKey: "nav.tabs.chartOfAccounts" },
  { id: "ledger", labelKey: "nav.tabs.ledger" },
  { id: "departments", labelKey: "nav.tabs.departments" },
  { id: "zakat", labelKey: "nav.tabs.zakat" },
];

export default function AccountsGroupModule({
  realCompanies, realCompanyId,
  legacyEntries, legacySales, legacyCompanyId,
}) {
  const [tab] = useModuleTab("/accounts", ACCOUNTS_TABS);
  // دخول مباشر لحساب معيّن (زر "عرض في شجرة الحسابات" من شاشة عميل/مورد/موظف، أو نتيجة بحث سريع)
  // عبر ?accountId= في رابط حقيقي (routes.accountLedger) بدل حالة تطبيق وسيطة كانت تُمرَّر يدوياً
  // من App.jsx — يُستهلَك (يُحذَف من الرابط) بمجرد فتح الكشف حتى لا يُفرَض على أي فتح لاحق للتبويب.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingLedgerAccountId = searchParams.get("accountId");

  return (
    <div>
      <SubTabs tabs={ACCOUNTS_TABS} active={tab} basePath="/accounts" />
      {tab === "journal" && <JournalModule companies={realCompanies} companyId={realCompanyId} />}
      {tab === "chartOfAccounts" && <ChartOfAccountsModule companies={realCompanies} companyId={realCompanyId} />}
      {tab === "ledger" && (
        <AccountLedgerModule
          companies={realCompanies} companyId={realCompanyId}
          initialAccountId={pendingLedgerAccountId}
          onConsumeInitialAccountId={() => setSearchParams({}, { replace: true })}
        />
      )}
      {tab === "departments" && <DepartmentsTab companyId={realCompanyId} />}
      {tab === "zakat" && <ZakatModule entries={legacyEntries} sales={legacySales} companyId={legacyCompanyId} />}
    </div>
  );
}
