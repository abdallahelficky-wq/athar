import React from "react";
import JournalModule from "./JournalModule";
import ChartOfAccountsModule from "./ChartOfAccountsModule";
import AccountLedgerModule from "./AccountLedgerModule";
import DepartmentsTab from "./DepartmentsTab";
import { ZakatModule } from "../legacy/zakat";
import SubTabs from "./shared/SubTabs";

export const ACCOUNTS_TABS = [
  { id: "journal", labelKey: "nav.tabs.journal" },
  { id: "chartOfAccounts", labelKey: "nav.tabs.chartOfAccounts" },
  { id: "ledger", labelKey: "nav.tabs.ledger" },
  { id: "departments", labelKey: "nav.tabs.departments" },
  { id: "zakat", labelKey: "nav.tabs.zakat" },
];

export default function AccountsGroupModule({
  tab, setTab,
  realCompanies, realCompanyId,
  legacyEntries, legacySales, legacyCompanyId,
  pendingLedgerAccountId, onConsumePendingLedgerAccountId,
}) {
  return (
    <div>
      <SubTabs tabs={ACCOUNTS_TABS} active={tab} onChange={setTab} />
      {tab === "journal" && <JournalModule companies={realCompanies} companyId={realCompanyId} />}
      {tab === "chartOfAccounts" && <ChartOfAccountsModule companies={realCompanies} companyId={realCompanyId} />}
      {tab === "ledger" && (
        <AccountLedgerModule
          companies={realCompanies} companyId={realCompanyId}
          initialAccountId={pendingLedgerAccountId} onConsumeInitialAccountId={onConsumePendingLedgerAccountId}
        />
      )}
      {tab === "departments" && <DepartmentsTab companyId={realCompanyId} />}
      {tab === "zakat" && <ZakatModule entries={legacyEntries} sales={legacySales} companyId={legacyCompanyId} />}
    </div>
  );
}
