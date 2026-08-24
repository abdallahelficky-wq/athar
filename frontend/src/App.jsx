import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./context/AuthContext";
import { NavIcon } from "./legacy/navIcons";
import { useCompanies } from "./wired/useCompanies";
import LanguageSwitcher from "./wired/shared/LanguageSwitcher";
import CompanySwitcher from "./wired/shared/CompanySwitcher";
import NotificationBell from "./wired/shared/NotificationBell";
import QuickSearch from "./wired/shared/QuickSearch";
import { getFinancialAlerts, getHrAlerts } from "./api/dashboard";
import { formatDate } from "./i18n/dateFormat";
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
  { id: "sales", labelKey: "nav.groups.sales", tabs: SALES_TABS },
  { id: "purchases", labelKey: "nav.groups.purchases", tabs: PURCHASE_TABS },
  { id: "inventory", labelKey: "nav.groups.inventory", tabs: INVENTORY_TABS },
  { id: "fixedAssets", labelKey: "nav.groups.fixedAssets", tabs: FIXED_ASSETS_TABS },
  { id: "accounts", labelKey: "nav.groups.accounts", tabs: ACCOUNTS_TABS },
  { id: "hr", labelKey: "nav.groups.hr", tabs: HR_TABS },
  { id: "reports", labelKey: "nav.groups.reports", tabs: REPORT_TABS },
  { id: "settings", labelKey: "nav.groups.settings", tabs: SETTINGS_TABS },
];

function AppShell({ onLoggedOut }) {
  const { t, i18n } = useTranslation();
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

  // شارات عددية حقيقية على "المبيعات"/"شئون الموظفين" بالقائمة الجانبية — من نفس تنبيهات لوحة
  // القيادة المالية/الموارد البشرية الموجودة أصلاً (بلا أي API جديد)، تُحمَّل هنا مرة واحدة على
  // مستوى التطبيق (لا داخل شاشة الداشبورد فقط) حتى تظهر الشارة بصرف النظر عن الصفحة المفتوحة حالياً.
  const [overdueInvoicesCount, setOverdueInvoicesCount] = useState(0);
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);
  useEffect(() => {
    if (!real.companyId) { setOverdueInvoicesCount(0); setPendingLeaveCount(0); return; }
    getFinancialAlerts(real.companyId).then((alerts) => {
      setOverdueInvoicesCount(alerts.filter((a) => a.type === "overdue_invoice").length);
    }).catch(() => {});
    getHrAlerts(real.companyId).then((alerts) => {
      setPendingLeaveCount(alerts.filter((a) => a.type === "unassigned_leave_request").length);
    }).catch(() => {});
  }, [real.companyId]);

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

  // من نتيجة البحث السريع (فاتورة مبيعات/مشتريات) — ينقل لشاشة الفواتير المناسبة مباشرة.
  const goToInvoices = (kind) => {
    if (kind === "sales") { setModuleId("sales"); setSalesTab("invoices"); }
    else if (kind === "purchases") { setModuleId("purchases"); setPurchasesTab("invoices"); }
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
  const navBadges = { sales: overdueInvoicesCount, hr: pendingLeaveCount };

  return (
    <div className="app-root" dir={i18n.dir()}>
      {isMobileSidebarOpen && <div className="sidebar-backdrop" onClick={() => setIsMobileSidebarOpen(false)} />}
      <div className={"sidebar" + (isMobileSidebarOpen ? " sidebar-open" : "")}>
        <div className="brand">
          <div className="brand-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <div>
            <div className="brand-name">{t("common.brandName")}</div>
            <div className="brand-sub">{tenant?.name}</div>
          </div>
          <button
            className="sidebar-close-btn"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-label={t("nav.closeMenu")}
          >✕</button>
        </div>

        <CompanySwitcher
          companies={real.companies}
          companyId={real.companyId}
          setCompanyId={real.setCompanyId}
          onViewAll={() => setModuleId("dashboard")}
        />

        <div className="sidebar-nav-scroll">
          <div className="nav-list">
            <button className={"nav-btn nav-home" + (moduleId === "dashboard" ? " active" : "")} onClick={() => setModuleId("dashboard")}>
              <span className="nav-icon"><NavIcon name="dashboard" /></span>
              <span>{t("nav.dashboard")}</span>
            </button>
          </div>

          <div className="nav-list">
            {NAV_GROUPS.map((g) => {
              const [curTab, setCurTab] = groupTabState[g.id];
              const isOpen = openGroupId === g.id;
              const badgeCount = navBadges[g.id] || 0;
              return (
                <div className="nav-group" key={g.id}>
                  <button className={"nav-group-toggle" + (moduleId === g.id ? " active" : "")} onClick={() => handleGroupClick(g.id)}>
                    <span className="nav-icon"><NavIcon name={g.id} /></span>
                    <span className="nav-label">{t(g.labelKey)}</span>
                    {badgeCount > 0 && (
                      <span className={"nav-badge " + (g.id === "sales" ? "nav-badge-danger" : "nav-badge-warning")}>{badgeCount}</span>
                    )}
                    <span className={"nav-caret" + (isOpen ? " open" : "")}>▾</span>
                  </button>
                  <div className={"nav-subitems-wrap" + (isOpen ? " open" : "")}>
                    <div className="nav-subitems-inner">
                      <div className="nav-subitems">
                        {g.tabs.map((tab) => (
                          <button
                            key={tab.id}
                            className={"nav-subitem" + (moduleId === g.id && curTab === tab.id ? " active" : "")}
                            onClick={() => { setModuleId(g.id); setCurTab(tab.id); }}
                          >
                            <span className="nav-icon nav-icon-sm"><NavIcon name={tab.id} /></span>
                            <span>{t(tab.labelKey)}</span>
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
      </div>

      <div className="main">
        <div className="topbar">
          <button className="hamburger-btn" onClick={() => setIsMobileSidebarOpen(true)} aria-label={t("nav.openMenu")}>☰</button>
          <span className="topbar-company" title={tenant?.name}>{activeCompany?.shortName || activeCompany?.name || t("nav.noCompanySelected")}</span>
          <QuickSearch companyId={real.companyId} onViewAccount={navigateToAccountLedger} onGoInvoices={goToInvoices} />
          <span className="topbar-date">{formatDate(new Date(), i18n.language)}</span>
          <NotificationBell
            overdueInvoicesCount={overdueInvoicesCount}
            pendingLeaveCount={pendingLeaveCount}
            onGoSales={() => setModuleId("sales")}
            onGoHr={() => setModuleId("hr")}
          />
          <LanguageSwitcher />
          <UserMenu
            name={user?.name}
            email={user?.email}
            onOpenProfile={() => { setModuleId("settings"); setSettingsTab("profile"); }}
            onLogout={async () => { await logout(); onLoggedOut(); }}
          />
        </div>

        <div className="app-content">
        <div className="app-content-inner">
        {!emailServiceConfigured && (user?.role === "admin" || user?.role === "super_admin") && (
          <div className="system-warning-banner">
            {t("nav.emailWarningBefore")} <code>RESEND_API_KEY</code> {t("nav.emailWarningAfter")}
          </div>
        )}

        {moduleId === "dashboard" && (
          <Dashboard
            companies={real.companies}
            companyId={real.companyId}
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
