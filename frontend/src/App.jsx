import React, { useMemo, useState } from "react";
import { useAuth } from "./context/AuthContext";
import { useCompanies } from "./wired/useCompanies";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import Dashboard from "./wired/Dashboard";
import AccountsGroupModule, { ACCOUNTS_TABS } from "./wired/AccountsGroupModule";
import ReportsModule, { REPORT_TABS } from "./wired/ReportsModule";

import {
  COMPANIES,
  seedEmployees, seedLeaves, seedLeaveSettlements, seedCustomers, seedSalesInvoices, seedSalesReturns,
  seedSuppliers, seedPurchaseInvoices, seedPurchaseReturns, seedItems, seedStockMovements, seedUsers,
  seedJobTitles, seedCompanyDocuments, seedFixedAssets, seedDepreciationRuns, seedHrActions, seedPayrollRuns,
  seedEntries, seedSales,
} from "./legacy/constants";
import { SalesModule, SALES_TABS } from "./legacy/sales";
import { PurchasesModule, PURCHASE_TABS } from "./legacy/purchases";
import { InventoryModule, INVENTORY_TABS } from "./legacy/inventory";
import { FixedAssetsModule, FIXED_ASSETS_TABS } from "./legacy/fixedAssets";
import { HRModule, HR_TABS } from "./legacy/hr";
import { SettingsModule, SETTINGS_TABS } from "./legacy/settings";

const NAV_GROUPS = [
  { id: "sales", label: "المبيعات", tabs: SALES_TABS },
  { id: "purchases", label: "المشتريات", tabs: PURCHASE_TABS },
  { id: "inventory", label: "المخزون", tabs: INVENTORY_TABS },
  { id: "fixedAssets", label: "الأصول الثابتة", tabs: FIXED_ASSETS_TABS },
  { id: "accounts", label: "الحسابات", tabs: ACCOUNTS_TABS },
  { id: "hr", label: "شئون الموظفين", tabs: HR_TABS },
  { id: "reports", label: "التقارير", tabs: REPORT_TABS },
  { id: "settings", label: "الإعدادات", tabs: SETTINGS_TABS },
];

function AppShell() {
  const { user, tenant, logout } = useAuth();
  const real = useCompanies();

  const [moduleId, setModuleId] = useState("dashboard");
  const [openGroups, setOpenGroups] = useState(["sales"]);

  // بيانات الشركة "القديمة" (تجريبية محلية) — تخص فقط الموديولات غير المرتبطة بعد بالـ API
  const [legacyCompanyId, setLegacyCompanyId] = useState("all");

  // ---- حالة الموديولات القديمة غير المرتبطة بعد بالـ API (كما كانت تماماً) ----
  const [legacyEntries, setLegacyEntries] = useState(seedEntries);
  const [sales, setSales] = useState(seedSales);
  const [employees, setEmployees] = useState(seedEmployees);
  const [leaves, setLeaves] = useState(seedLeaves);
  const [leaveSettlements, setLeaveSettlements] = useState(seedLeaveSettlements);
  const [customers, setCustomers] = useState(seedCustomers);
  const [salesInvoices, setSalesInvoices] = useState(seedSalesInvoices);
  const [salesReturns, setSalesReturns] = useState(seedSalesReturns);
  const [salesQuotes, setSalesQuotes] = useState([]);
  const [salesReceipts, setSalesReceipts] = useState([]);
  const [suppliers, setSuppliers] = useState(seedSuppliers);
  const [purchaseInvoices, setPurchaseInvoices] = useState(seedPurchaseInvoices);
  const [purchaseReturns, setPurchaseReturns] = useState(seedPurchaseReturns);
  const [items, setItems] = useState(seedItems);
  const [stockMovements, setStockMovements] = useState(seedStockMovements);
  const [users, setUsers] = useState(seedUsers);
  const [currentUser, setCurrentUser] = useState(() => ({
    ...seedUsers[0],
    name: user?.name || seedUsers[0].name,
    email: user?.email || seedUsers[0].email,
  }));
  const [jobTitles, setJobTitles] = useState(seedJobTitles);
  const [hrActions, setHrActions] = useState(seedHrActions);
  const [payrollRuns, setPayrollRuns] = useState(seedPayrollRuns);
  const [legacyUnlockPin, setLegacyUnlockPin] = useState("1234");
  const [companyDocuments, setCompanyDocuments] = useState(seedCompanyDocuments);
  const [fixedAssets, setFixedAssets] = useState(seedFixedAssets);
  const [depreciationRuns, setDepreciationRuns] = useState(seedDepreciationRuns);
  const [fixedAssetsTab, setFixedAssetsTab] = useState("register");
  const [settingsVersion, setSettingsVersion] = useState(0);
  const bumpSettings = () => setSettingsVersion((v) => v + 1);

  const [salesTab, setSalesTab] = useState("customers");
  const [purchasesTab, setPurchasesTab] = useState("suppliers");
  const [inventoryTab, setInventoryTab] = useState("items");
  const [accountsTab, setAccountsTab] = useState("journal");
  const [hrTab, setHrTab] = useState("directory");
  const [reportsTab, setReportsTab] = useState("trial");
  const [settingsTab, setSettingsTab] = useState("companies");

  const groupTabState = {
    sales: [salesTab, setSalesTab],
    purchases: [purchasesTab, setPurchasesTab],
    inventory: [inventoryTab, setInventoryTab],
    fixedAssets: [fixedAssetsTab, setFixedAssetsTab],
    accounts: [accountsTab, setAccountsTab],
    hr: [hrTab, setHrTab],
    reports: [reportsTab, setReportsTab],
    settings: [settingsTab, setSettingsTab],
  };

  const toggleGroup = (id) => {
    setOpenGroups((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };
  const openGroupAndSelect = (id) => {
    setModuleId(id);
    setOpenGroups((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const activeLegacyCompany = useMemo(() => COMPANIES.find((c) => c.id === legacyCompanyId), [legacyCompanyId]);

  return (
    <div className="app-root" dir="rtl">
      <div className="sidebar">
        <div className="brand">
          <div className="brand-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <div>
            <div className="brand-name">أثر المحاسبي</div>
            <div className="brand-sub">{tenant?.name}</div>
          </div>
        </div>

        <div className="nav-list">
          <button className={"nav-btn nav-home" + (moduleId === "dashboard" ? " active" : "")} onClick={() => setModuleId("dashboard")}>
            لوحة القيادة
          </button>
        </div>

        <div className="nav-list">
          {NAV_GROUPS.map((g) => {
            const [curTab, setCurTab] = groupTabState[g.id];
            const isOpen = openGroups.includes(g.id);
            return (
              <div className="nav-group" key={g.id}>
                <button className={"nav-group-toggle" + (moduleId === g.id ? " active" : "")} onClick={() => openGroupAndSelect(g.id)}>
                  <span>{g.label}</span>
                  <span className="nav-caret" onClick={(e) => { e.stopPropagation(); toggleGroup(g.id); }}>{isOpen ? "▾" : "◂"}</span>
                </button>
                {isOpen && (
                  <div className="nav-subitems">
                    {g.tabs.map((t) => (
                      <button
                        key={t.id}
                        className={"nav-subitem" + (moduleId === g.id && curTab === t.id ? " active" : "")}
                        onClick={() => { setModuleId(g.id); setCurTab(t.id); }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button className="btn-ghost" onClick={logout} style={{ marginTop: "auto" }}>تسجيل الخروج</button>
      </div>

      <div className="main">
        <div className="topbar">
          <span className="topbar-company">{user?.name} — {tenant?.name}</span>
          <span className="topbar-date">{new Date().toLocaleDateString("ar-SA")}</span>
        </div>

        {moduleId === "dashboard" && (
          <Dashboard
            companies={real.companies}
            companyId={real.companyId}
            setCompanyId={real.setCompanyId}
            onCompanyCreated={real.onCompanyCreated}
          />
        )}

        {moduleId === "sales" && (
          <SalesModule
            customers={customers} setCustomers={setCustomers}
            invoices={salesInvoices} setInvoices={setSalesInvoices}
            returns={salesReturns} setReturns={setSalesReturns}
            quotes={salesQuotes} setQuotes={setSalesQuotes}
            receipts={salesReceipts} setReceipts={setSalesReceipts}
            sales={sales} setSales={setSales}
            entries={legacyEntries} setEntries={setLegacyEntries}
            companyId={legacyCompanyId} tab={salesTab} setTab={setSalesTab} unlockPin={legacyUnlockPin}
          />
        )}

        {moduleId === "purchases" && (
          <PurchasesModule
            suppliers={suppliers} setSuppliers={setSuppliers}
            invoices={purchaseInvoices} setInvoices={setPurchaseInvoices}
            returns={purchaseReturns} setReturns={setPurchaseReturns}
            entries={legacyEntries} setEntries={setLegacyEntries}
            companyId={legacyCompanyId} tab={purchasesTab} setTab={setPurchasesTab} unlockPin={legacyUnlockPin}
          />
        )}

        {moduleId === "inventory" && (
          <InventoryModule
            items={items} setItems={setItems}
            movements={stockMovements} setMovements={setStockMovements}
            entries={legacyEntries} setEntries={setLegacyEntries}
            companyId={legacyCompanyId} tab={inventoryTab} setTab={setInventoryTab}
          />
        )}

        {moduleId === "fixedAssets" && (
          <FixedAssetsModule
            assets={fixedAssets} setAssets={setFixedAssets}
            depreciationRuns={depreciationRuns} setDepreciationRuns={setDepreciationRuns}
            entries={legacyEntries} setEntries={setLegacyEntries}
            companyId={legacyCompanyId} tab={fixedAssetsTab} setTab={setFixedAssetsTab}
          />
        )}

        {moduleId === "accounts" && (
          <AccountsGroupModule
            tab={accountsTab} setTab={setAccountsTab}
            realCompanies={real.companies} realCompanyId={real.companyId}
            setRealCompanyId={real.setCompanyId} onRealCompanyCreated={real.onCompanyCreated}
            legacyEntries={legacyEntries} legacySales={sales} legacyCompanyId={legacyCompanyId}
          />
        )}

        {moduleId === "hr" && (
          <HRModule
            employees={employees} setEmployees={setEmployees}
            leaves={leaves} setLeaves={setLeaves}
            entries={legacyEntries} setEntries={setLegacyEntries}
            leaveSettlements={leaveSettlements} setLeaveSettlements={setLeaveSettlements}
            hrActions={hrActions} setHrActions={setHrActions}
            payrollRuns={payrollRuns} setPayrollRuns={setPayrollRuns}
            unlockPin={legacyUnlockPin} companyId={legacyCompanyId} tab={hrTab} setTab={setHrTab}
          />
        )}

        {moduleId === "reports" && (
          <ReportsModule
            companies={real.companies} companyId={real.companyId}
            setCompanyId={real.setCompanyId} onCompanyCreated={real.onCompanyCreated}
            tab={reportsTab} setTab={setReportsTab}
          />
        )}

        {moduleId === "settings" && (
          <SettingsModule
            tab={settingsTab} setTab={setSettingsTab}
            users={users} setUsers={setUsers}
            currentUser={currentUser} setCurrentUser={setCurrentUser}
            jobTitles={jobTitles} setJobTitles={setJobTitles}
            unlockPin={legacyUnlockPin} setUnlockPin={setLegacyUnlockPin}
            companyDocuments={companyDocuments} setCompanyDocuments={setCompanyDocuments}
            onDataChange={bumpSettings}
            realCompanies={real.companies} reloadRealCompanies={real.reload}
          />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, initializing } = useAuth();
  const [siteView, setSiteView] = useState("landing");

  if (initializing) return null;

  if (!isAuthenticated) {
    if (siteView === "login") {
      return <LoginPage onGoLanding={() => setSiteView("landing")} onGoRegister={() => setSiteView("register")} />;
    }
    if (siteView === "register") {
      return <RegisterPage onGoLanding={() => setSiteView("landing")} onGoLogin={() => setSiteView("login")} />;
    }
    return <LandingPage onGoLogin={() => setSiteView("login")} onGoRegister={() => setSiteView("register")} />;
  }

  return <AppShell />;
}
