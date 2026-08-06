import React from "react";
import JournalModule from "./JournalModule";
import ChartOfAccountsModule from "./ChartOfAccountsModule";
import AccountLedgerModule from "./AccountLedgerModule";
import { ZakatModule } from "../legacy/zakat";
import SubTabs from "./shared/SubTabs";

export const ACCOUNTS_TABS = [
  { id: "journal", label: "القيود اليومية" },
  { id: "chartOfAccounts", label: "شجرة الحسابات" },
  { id: "ledger", label: "كشف حساب الأستاذ" },
  { id: "zakat", label: "الزكاة والضريبة (تقديرية، بيانات تجريبية)" },
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
      {tab === "zakat" && <ZakatModule entries={legacyEntries} sales={legacySales} companyId={legacyCompanyId} />}
    </div>
  );
}
