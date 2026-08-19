import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "./context/AuthContext";
import { NavIcon } from "./legacy/navIcons";
import { useCompanies } from "./wired/useCompanies";
import LanguageSwitcher from "./wired/shared/LanguageSwitcher";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
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
import UserMenu from "./wired/shared/UserMenu";

const NAV_GROUPS = [
  { id: "sales", label: "المبيعات", tabs: SALES_TABS },
  { id: "purchases", label: "المشتريات", tabs: PURCHASE_TABS },
  { id: "inventory", label: "المستودعات والمنتجات", tabs: INVENTORY_TABS },
  { id: "fixedAssets", label: "الأصول الثابتة", tabs: FIXED_ASSETS_TABS },
  { id: "accounts", label: "الحسابات", tabs: ACCOUNTS_TABS },
  { id: "hr", label: "شئون الموظفين", tabs: HR_TABS },
  { id: "reports", label: "التقارير", tabs: REPORT_TABS },
  { id: "settings", label: "الإعدادات", tabs: SETTINGS_TABS },
];

function AppShell({ onLoggedOut }) {
  const { user, tenant, logout, emailServiceConfigured } = useAuth();
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

  const [currentUser, setCurrentUser] = useState(() => ({
    ...seedUsers[0],
    name: user?.name || seedUsers[0].name,
    email: user?.email || seedUsers[0].email,
  }));
  const [jobTitles, setJobTitles] = useState(seedJobTitles);
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

  // دخول مباشر من شاشة عميل/مورد/موظف لكشف حسابه في شجرة الحسابات ("عرض في شجرة الحسابات") —
  // يفتح قسم الحسابات على تبويب "كشف حساب الأستاذ" مباشرة على حساب الطرف المحدد.
  const [pendingLedgerAccountId, setPendingLedgerAccountId] = useState(null);
  const navigateToAccountLedger = (accountId) => {
    if (!accountId) return;
    setModuleId("accounts");
    setAccountsTab("ledger");
    setPendingLedgerAccountId(accountId);
  };

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
      </div>

      <div className="main">
        <div className="topbar">
          <button className="hamburger-btn" onClick={() => setIsMobileSidebarOpen(true)} aria-label="فتح القائمة">☰</button>
          <span className="topbar-company">{tenant?.name}</span>
          <button className="topbar-active-company" onClick={() => setModuleId("dashboard")} title="الرجوع للشاشة الرئيسية لتبديل الشركة">
            الشركة النشطة: <strong>{activeCompany?.shortName || activeCompany?.name || "لم تُختَر بعد"}</strong>
          </button>
          <span className="topbar-date">{new Date().toLocaleDateString("ar-SA")}</span>
          <LanguageSwitcher />
          <UserMenu
            name={user?.name}
            email={user?.email}
            onOpenProfile={() => { setModuleId("settings"); setSettingsTab("profile"); }}
            onLogout={async () => { await logout(); onLoggedOut(); }}
          />
        </div>

        {!emailServiceConfigured && (user?.role === "admin" || user?.role === "super_admin") && (
          <div className="system-warning-banner">
            ⚠️ خدمة إرسال الإيميلات غير مفعَّلة على الخادم — الإيميلات (ترحيب، دعوة مستخدم، إرسال فاتورة)
            لن تصل لأي مستلم. راجِع متغيّر <code>RESEND_API_KEY</code> في إعدادات النشر.
          </div>
        )}

        {moduleId === "dashboard" && (
          <Dashboard
            companies={real.companies}
            companyId={real.companyId}
            setCompanyId={real.setCompanyId}
            onNavigateToCompanySettings={() => { setModuleId("settings"); setSettingsTab("companies"); }}
          />
        )}

        {moduleId === "sales" && (
          <SalesWiredModule tab={salesTab} setTab={setSalesTab} companies={real.companies} companyId={real.companyId} onViewAccount={navigateToAccountLedger} />
        )}

        {moduleId === "purchases" && (
          <PurchasesWiredModule tab={purchasesTab} setTab={setPurchasesTab} companies={real.companies} companyId={real.companyId} onViewAccount={navigateToAccountLedger} />
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
            pendingLedgerAccountId={pendingLedgerAccountId}
            onConsumePendingLedgerAccountId={() => setPendingLedgerAccountId(null)}
          />
        )}

        {moduleId === "hr" && (
          <HRWiredModule tab={hrTab} setTab={setHrTab} companies={real.companies} companyId={real.companyId} onViewAccount={navigateToAccountLedger} />
        )}

        {moduleId === "reports" && (
          <ReportsModule companies={real.companies} companyId={real.companyId} tab={reportsTab} setTab={setReportsTab} />
        )}

        {moduleId === "settings" && (
          <SettingsModule
            tab={settingsTab} setTab={setSettingsTab}
            currentUser={currentUser} setCurrentUser={setCurrentUser}
            jobTitles={jobTitles} setJobTitles={setJobTitles}
            companyDocuments={companyDocuments} setCompanyDocuments={setCompanyDocuments}
            onDataChange={bumpSettings}
            realCompanies={real.companies} reloadRealCompanies={real.reload} onRealCompanyCreated={real.onCompanyCreated}
          />
        )}
      </div>
    </div>
  );
}

// يقرأ رمز إعادة تعيين كلمة المرور/تفعيل الدعوة من رابط الإيميل مرة واحدة فقط عند أول تحميل الوحدة
// (module scope، وليس داخل useState lazy initializer) — لأن React.StrictMode يستدعي دوال التهيئة
// الكسولة (lazy initializer) مرتين في وضع التطوير لاكتشاف أي أعراض جانبية غير نقية، وهذه الدالة
// تحمل عرَضاً جانبياً حقيقياً (history.replaceState يزيل الرمز من شريط العنوان). لو نُفِّذت داخل
// useState، الاستدعاء الثاني يقرأ رابطاً أُفرِغ من الرمز بالفعل ويُرجع null، وهذا هو ما كان يُعتمَد
// كحالة أولية فعلياً — فتشغيلها هنا مرة واحدة فقط عند تحميل الوحدة يجعلها محصّنة ضد هذا السلوك.
function readAndConsumeUrlToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  return token;
}

const isAcceptInvitePath = window.location.pathname === "/accept-invite";
const initialUrlToken = readAndConsumeUrlToken();

export default function App() {
  const { isAuthenticated, initializing } = useAuth();
  const [siteView, setSiteView] = useState(() => {
    if (isAcceptInvitePath) return "accept-invite";
    return initialUrlToken ? "reset-password" : "landing";
  });
  const [resetToken, setResetToken] = useState(isAcceptInvitePath ? null : initialUrlToken);
  const [inviteToken] = useState(isAcceptInvitePath ? initialUrlToken : null);

  if (initializing) return null;

  // شاشة إعادة تعيين كلمة المرور تُعرض بصرف النظر عن وجود جلسة مفتوحة بالفعل في هذا المتصفح —
  // المستخدم قد يضغط رابط الاستعادة على جهاز فيه جلسة أخرى غير متصلة بالحساب المقصود.
  if (siteView === "reset-password") {
    return (
      <ResetPasswordPage
        token={resetToken}
        onGoLogin={() => { setResetToken(null); setSiteView("login"); }}
        onGoForgotPassword={() => { setResetToken(null); setSiteView("forgot-password"); }}
      />
    );
  }

  // بمجرد نجاح تفعيل الدعوة يُسجَّل الدخول تلقائياً (isAuthenticated يصبح true) فتسقط هذه الشرطية
  // تلقائياً وتظهر واجهة التطبيق الرئيسية بلا أي تنقّل يدوي إضافي.
  if (siteView === "accept-invite" && !isAuthenticated) {
    return <AcceptInvitePage token={inviteToken} onGoLogin={() => setSiteView("login")} />;
  }

  if (!isAuthenticated) {
    if (siteView === "login") {
      return (
        <LoginPage
          onGoLanding={() => setSiteView("landing")}
          onGoRegister={() => setSiteView("register")}
          onGoForgotPassword={() => setSiteView("forgot-password")}
        />
      );
    }
    if (siteView === "register") {
      return <RegisterPage onGoLanding={() => setSiteView("landing")} onGoLogin={() => setSiteView("login")} />;
    }
    if (siteView === "forgot-password") {
      return <ForgotPasswordPage onGoLogin={() => setSiteView("login")} />;
    }
    return <LandingPage onGoLogin={() => setSiteView("login")} onGoRegister={() => setSiteView("register")} />;
  }

  return <AppShell onLoggedOut={() => setSiteView("login")} />;
}
