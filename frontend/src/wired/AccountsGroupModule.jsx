import React from "react";
import JournalModule from "./JournalModule";
import ChartOfAccountsModule from "./ChartOfAccountsModule";
import { ZakatModule } from "../legacy/zakat";

export const ACCOUNTS_TABS = [
  { id: "journal", label: "القيود اليومية" },
  { id: "chartOfAccounts", label: "شجرة الحسابات" },
  { id: "zakat", label: "الزكاة والضريبة (تقديرية، بيانات تجريبية)" },
];

export default function AccountsGroupModule({
  tab, setTab,
  realCompanies, realCompanyId, setRealCompanyId, onRealCompanyCreated,
  legacyEntries, legacySales, legacyCompanyId,
}) {
  return (
    <div>
      <div className="report-tabs">
        {ACCOUNTS_TABS.map((t) => (
          <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "journal" && (
        <JournalModule
          companies={realCompanies}
          companyId={realCompanyId}
          setCompanyId={setRealCompanyId}
          onCompanyCreated={onRealCompanyCreated}
        />
      )}
      {tab === "chartOfAccounts" && <ChartOfAccountsModule />}
      {tab === "zakat" && <ZakatModule entries={legacyEntries} sales={legacySales} companyId={legacyCompanyId} />}
    </div>
  );
}
