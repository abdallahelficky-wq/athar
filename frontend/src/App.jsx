import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "./context/AuthContext";
import { NavIcon } from "./legacy/navIcons";
import { useCompanies } from "./wired/useCompanies";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import Dashboard from "./wired/Dashboard";
import AccountsGroupModule, { ACCOUNTS_TABS } from "./wired/AccountsGroupModule";
import ReportsModule, { REPORT_TABS } from "./wired/ReportsModule";

import {
  COMPANIES,
  seedUsers, seedJobTitles, seedCompanyDocuments, seedEntries, seedSales,
} from "./legacy/constants";
import { SettingsModule, SETTINGS_TABS } from "./legacy/settings";
import SalesWiredModule, { SALES_TABS } from "./wired/sales/SalesWiredModule";
import PurchasesWiredModule, { PURCHASE_TABS } from "./wired/purchases/PurchasesWiredModule";
import InventoryWiredModule, { INVENTORY_TABS } from "./wired/inventory/InventoryWiredModule";
import FixedAssetsWiredModule, { FIXED_ASSETS_TABS } from "./wired/fixedAssets/FixedAssetsWiredModule";
import HRWiredModule, { HR_TABS } from "./wired/hr/HRWiredModule";

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
  // القائمة الجانبية على شاشات الموبايل تُعرَض كلوحة منزلقة (off-canvas) خلف زر همبرغر بدل
  // أن تكون ثابتة دائماً كما في سطح المكتب — تُغلَق تلقائياً بعد أي تنقّل لصفحة جديدة.
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  // قسم واحد فقط مفتوح في القائمة الجانبية في أي وقت (Accordion حقيقي) — يُزامَن تلقائياً مع
  // moduleId (القسم الذي فيه الصفحة الحالية يُفتح تلقائياً)، لكن إغلاقه يدوياً بينما لا يزال
  // moduleId مطابقاً له لا يُعاد فتحه قسراً (useEffect لا يُعاد تشغيله إلا عند تغيّر moduleId فعلاً)
  const [openGroupId, setOpenGroupId] = useState(null);
  useEffect(() => {
    if (NAV_GROUPS.some((g) => g.id === moduleId)) setOpenGroupId(moduleId);
    setIsMobileSidebarOpen(false);
  }, [moduleId]);

  // بيانات الشركة "القديمة" (تجريبية محلية) — تخص فقط وحدة الزكاة التوضيحية غير المرتبطة بعد بالـ API
  const [legacyCompanyId, setLegacyCompanyId] = useState("all");
  const [legacyEntries] = useState(seedEntries);
  const [sales] = useState(seedSales);

  const [users, setUsers] = useState(seedUsers);
  const [currentUser, setCurrentUser] = useState(() => ({
    ...seedUsers[0],
    name: user?.name || seedUsers[0].name,
    email: user?.email || seedUsers[0].email,
  }));
  const [jobTitles, setJobTitles] = useState(seedJobTitles);
  const [legacyUnlockPin, setLegacyUnlockPin] = useState("1234");
  const [companyDocuments, setCompanyDocuments] = useState(seedCompanyDocuments);
  const [fixedAssetsTab, setFixedAssetsTab] = useState("register");
  const [settingsVersion, setSettingsVersion] = useState(0);
  const bumpSettings = () => setSettingsVersion((v) => v + 1);

  const [salesTab, setSalesTab] = useState("customers");
  const [purchasesTab, setPurchasesTab] = useState("suppliers");
  const [inventoryTab, setInventoryTab] = useState("items");
  const [accountsTab, setAccountsTab] = useState("journal");
  const [hrTab, setHrTab] = useState("dashboard");
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

  /** الضغط على صف القسم في أي مكان منه (الاسم أو السهم): لو القسم هو الصفحة المعروضة حالياً
   * بالفعل، فقط بدّل حالة الطي (توسيع/تصغير) بدون أي تنقّل؛ ولو قسم مختلف، انتقل إليه — سيُفتح
   * تلقائياً (ويُغلق أي قسم آخر مفتوح تلقائياً معه، لأن الحالة واحدة مشتركة لا مصفوفة). */
  const handleGroupClick = (id) => {
    if (moduleId === id) {
      setOpenGroupId((prev) => (prev === id ? null : id));
    } else {
      setModuleId(id);
    }
  };

  const activeLegacyCompany = useMemo(() => COMPANIES.find((c) => c.id === legacyCompanyId), [legacyCompanyId]);
  const activeCompany = useMemo(() => real.companies.find((c) => c.id === real.companyId), [real.companies, real.companyId]);

  return (
    <div className="app-root" dir="rtl">
      {isMobileSidebarOpen && <div className="sidebar-backdrop" onClick={() => setIsMobileSidebarOpen(false)} />}
      <div className={"sidebar" + (isMobileSidebarOpen ? " sidebar-open" : "")}>
        <div className="brand">
          <div className="brand-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <div>
            <div className="brand-name">أثر المحاسبي</div>
            <div className="brand-sub">{tenant?.name}</div>
          </div>
          <button
            className="sidebar-close-btn"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-label="إغلاق القائمة"
          >✕</button>
        </div>

        <div className="nav-list">
          <button className={"nav-btn nav-home" + (moduleId === "dashboard" ? " active" : "")} onClick={() => setModuleId("dashboard")}>
            <span className="nav-icon"><NavIcon name="dashboard" /></span>
            <span>لوحة القيادة</span>
          </button>
        </div>

        <div className="nav-list">
          {NAV_GROUPS.map((g) => {
            const [curTab, setCurTab] = groupTabState[g.id];
            const isOpen = openGroupId === g.id;
            return (
              <div className="nav-group" key={g.id}>
                <button className={"nav-group-toggle" + (moduleId === g.id ? " active" : "")} onClick={() => handleGroupClick(g.id)}>
                  <span className="nav-icon"><NavIcon name={g.id} /></span>
                  <span className="nav-label">{g.label}</span>
                  <span className={"nav-caret" + (isOpen ? " open" : "")}>▾</span>
                </button>
                <div className={"nav-subitems-wrap" + (isOpen ? " open" : "")}>
                  <div className="nav-subitems-inner">
                    <div className="nav-subitems">
                      {g.tabs.map((t) => (
                        <button
                          key={t.id}
                          className={"nav-subitem" + (moduleId === g.id && curTab === t.id ? " active" : "")}
                          onClick={() => { setModuleId(g.id); setCurTab(t.id); }}
                        >
                          <span className="nav-icon nav-icon-sm"><NavIcon name={t.id} /></span>
                          <span>{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button className="btn-ghost" onClick={logout} style={{ marginTop: "auto" }}>تسجيل الخروج</button>
      </div>

      <div className="main">
        <div className="topbar">
          <button className="hamburger-btn" onClick={() => setIsMobileSidebarOpen(true)} aria-label="فتح القائمة">☰</button>
          <span className="topbar-company">{user?.name} — {tenant?.name}</span>
          <button className="topbar-active-company" onClick={() => setModuleId("dashboard")} title="الرجوع للشاشة الرئيسية لتبديل الشركة">
            الشركة النشطة: <strong>{activeCompany?.shortName || activeCompany?.name || "لم تُختَر بعد"}</strong>
          </button>
          <span className="topbar-date">{new Date().toLocaleDateString("ar-SA")}</span>
        </div>

        {moduleId === "dashboard" && (
          <Dashboard
            companies={real.companies}
            companyId={real.companyId}
            setCompanyId={real.setCompanyId}
            onNavigateToCompanySettings={() => { setModuleId("settings"); setSettingsTab("companies"); }}
          />
        )}

        {moduleId === "sales" && (
          <SalesWiredModule tab={salesTab} setTab={setSalesTab} companies={real.companies} companyId={real.companyId} />
        )}

        {moduleId === "purchases" && (
          <PurchasesWiredModule tab={purchasesTab} setTab={setPurchasesTab} companies={real.companies} companyId={real.companyId} />
        )}

        {moduleId === "inventory" && (
          <InventoryWiredModule tab={inventoryTab} setTab={setInventoryTab} companies={real.companies} companyId={real.companyId} />
        )}

        {moduleId === "fixedAssets" && (
          <FixedAssetsWiredModule tab={fixedAssetsTab} setTab={setFixedAssetsTab} companies={real.companies} companyId={real.companyId} />
        )}

        {moduleId === "accounts" && (
          <AccountsGroupModule
            tab={accountsTab} setTab={setAccountsTab}
            realCompanies={real.companies} realCompanyId={real.companyId}
            legacyEntries={legacyEntries} legacySales={sales} legacyCompanyId={legacyCompanyId}
          />
        )}

        {moduleId === "hr" && (
          <HRWiredModule tab={hrTab} setTab={setHrTab} companies={real.companies} companyId={real.companyId} />
        )}

        {moduleId === "reports" && (
          <ReportsModule companies={real.companies} companyId={real.companyId} tab={reportsTab} setTab={setReportsTab} />
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
            realCompanies={real.companies} reloadRealCompanies={real.reload} onRealCompanyCreated={real.onCompanyCreated}
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
