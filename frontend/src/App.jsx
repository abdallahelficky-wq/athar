import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createBrowserRouter, RouterProvider, Navigate, Outlet, Link,
  useLocation, useNavigate, useOutletContext, useSearchParams,
} from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { NavIcon } from "./legacy/navIcons";
import { useCompanies } from "./wired/useCompanies";
import LanguageSwitcher from "./wired/shared/LanguageSwitcher";
import CompanySwitcher from "./wired/shared/CompanySwitcher";
import NotificationBell from "./wired/shared/NotificationBell";
import QuickSearch from "./wired/shared/QuickSearch";
import { getFinancialAlerts, getHrAlerts } from "./api/dashboard";
import { formatDate } from "./i18n/dateFormat";
import { routes } from "./routes";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import JournalEntryStandalonePage from "./pages/JournalEntryStandalonePage";
import Dashboard from "./wired/Dashboard";
import AtharShellDashboardPilot from "./wired/AtharShellDashboardPilot";
import AtharShellSalesPilot from "./wired/AtharShellSalesPilot";
import AccountsGroupModule, { ACCOUNTS_TABS } from "./wired/AccountsGroupModule";
import ReportsModule, { REPORT_TABS } from "./wired/ReportsModule";

import { seedUsers, seedJobTitles, seedCompanyDocuments, seedEntries, seedSales } from "./legacy/constants";
import { SettingsModule, SETTINGS_TABS } from "./legacy/settings";
import SalesWiredModule, { SALES_TABS } from "./wired/sales/SalesWiredModule";
import PurchasesWiredModule, { PURCHASE_TABS } from "./wired/purchases/PurchasesWiredModule";
import InventoryWiredModule, { INVENTORY_TABS } from "./wired/inventory/InventoryWiredModule";
import FixedAssetsWiredModule, { FIXED_ASSETS_TABS } from "./wired/fixedAssets/FixedAssetsWiredModule";
import HRWiredModule, { HR_TABS } from "./wired/hr/HRWiredModule";
import StablesModule, { STABLE_TABS } from "./wired/stables/StablesModule";
import UserMenu from "./wired/shared/UserMenu";
import { UnsavedChangesProvider } from "./wired/shared/UnsavedChangesContext";
import UnsavedChangesBlocker from "./wired/shared/UnsavedChangesBlocker";

export const NAV_GROUPS = [
  { id: "sales", labelKey: "nav.groups.sales", tabs: SALES_TABS, to: routes.sales },
  { id: "purchases", labelKey: "nav.groups.purchases", tabs: PURCHASE_TABS, to: routes.purchases },
  { id: "inventory", labelKey: "nav.groups.inventory", tabs: INVENTORY_TABS, to: routes.inventory },
  { id: "stables", labelKey: "stables.title", tabs: STABLE_TABS, to: routes.stables },
  { id: "fixedAssets", labelKey: "nav.groups.fixedAssets", tabs: FIXED_ASSETS_TABS, to: routes.fixedAssets },
  { id: "accounts", labelKey: "nav.groups.accounts", tabs: ACCOUNTS_TABS, to: routes.accounts },
  { id: "hr", labelKey: "nav.groups.hr", tabs: HR_TABS, to: routes.hr },
  { id: "reports", labelKey: "nav.groups.reports", tabs: REPORT_TABS, to: routes.reports },
  { id: "settings", labelKey: "nav.groups.settings", tabs: SETTINGS_TABS, to: routes.settings },
];

/** أول جزء من المسار الحالي (مثلاً "sales" من "/sales/invoices") — يُستخدَم لمعرفة أي قسم من
 * القائمة الجانبية نشط حالياً ومطابقته لأحد NAV_GROUPS، بدل حالة moduleId منفصلة كانت تُدار يدوياً. */
function currentGroupId(pathname) {
  return pathname.split("/")[1] || "";
}

/** نقرة يسرى عادية بلا مفاتيح تعديل (Ctrl/Cmd/Shift/Alt) ولا زر أوسط — الحالة الوحيدة التي يجب
 * فيها اعتراض النقر لتنفيذ منطق خاص (كطيّ/فتح قسم القائمة الجانبية بدل التنقّل)؛ أي نقرة أخرى
 * (Ctrl+Click، الزر الأوسط...) يجب أن تُترَك للمتصفح ليتعامل معها بسلوكه الطبيعي (فتح تبويب جديد). */
function isPlainLeftClick(e) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function AppShell() {
  const { t, i18n } = useTranslation();
  const { user, tenant, logout, emailServiceConfigured, platformNotices } = useAuth();
  const real = useCompanies();
  const activeCompany = useMemo(() => real.companies.find((c) => c.id === real.companyId), [real.companies, real.companyId]);
  // صلاحيات مدير المنصة تحدد الموديولات المتاحة للمستأجر، ثم نشاط الشركة النشطة يحدد الموديولات
  // القطاعية التي تخصها. مديول الإسطبلات لا يظهر ولا يُفتح إلا لنشاط الإسطبلات والإعاشة.
  const visibleNavGroups = NAV_GROUPS.filter((group) => {
    const platformAllows = !tenant?.enabledModules?.length || tenant.enabledModules.includes(group.id);
    const activityAllows = group.id !== "stables" || activeCompany?.businessActivity === "horse_stables";
    return platformAllows && activityAllows;
  });
  const location = useLocation();
  const navigate = useNavigate();

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const activeGroupId = currentGroupId(location.pathname);
  // قسم واحد فقط مفتوح في القائمة الجانبية في أي وقت (Accordion حقيقي) — يُزامَن تلقائياً مع
  // القسم الحالي من الرابط (كان يُزامَن مع moduleId state، الآن مع location.pathname مباشرة)، لكن
  // إغلاقه يدوياً بينما لا يزال هو القسم الحالي لا يُعاد فتحه قسراً.
  const [openGroupId, setOpenGroupId] = useState(null);
  useEffect(() => {
    if (visibleNavGroups.some((g) => g.id === activeGroupId)) setOpenGroupId(activeGroupId);
    setIsMobileSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId]);

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
  const [legacyCompanyId] = useState("all");
  const [legacyEntries] = useState(seedEntries);
  const [sales] = useState(seedSales);

  const [currentUser, setCurrentUser] = useState(() => ({
    ...seedUsers[0],
    name: user?.name || seedUsers[0].name,
    email: user?.email || seedUsers[0].email,
  }));
  const [jobTitles, setJobTitles] = useState(seedJobTitles);
  const [companyDocuments, setCompanyDocuments] = useState(seedCompanyDocuments);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const bumpSettings = () => setSettingsVersion((v) => v + 1);

  /** الضغط على صف القسم في أي مكان منه (الاسم أو السهم): لو القسم هو الصفحة المعروضة حالياً
   * بالفعل، فقط بدّل حالة الطي (توسيع/تصغير) بدون أي تنقّل؛ ولو قسم مختلف، اترك الرابط الحقيقي
   * ينقل إليه بشكل طبيعي (Ctrl/Cmd+Click أو الزر الأوسط يفتحانه في تبويب جديد كما هو متوقَّع من
   * أي رابط حقيقي، بصرف النظر عن كون القسم نشطاً حالياً أم لا — الاعتراض هنا فقط للنقرة اليسرى
   * العادية على القسم النشط أصلاً). */
  const handleGroupClick = (e, id) => {
    if (!isPlainLeftClick(e)) return;
    if (activeGroupId === id) {
      e.preventDefault();
      setOpenGroupId((prev) => (prev === id ? null : id));
    }
  };

  const navBadges = { sales: overdueInvoicesCount, hr: pendingLeaveCount };

  const outletContext = {
    companies: real.companies,
    companyId: real.companyId,
    currentUser, setCurrentUser,
    jobTitles, setJobTitles,
    companyDocuments, setCompanyDocuments,
    onDataChange: bumpSettings,
    realCompanies: real.companies, reloadRealCompanies: real.reload, onRealCompanyCreated: real.onCompanyCreated,
    legacyEntries, legacySales: sales, legacyCompanyId,
  };

  return (
    <div className="app-root" dir={i18n.dir()}>
      <UnsavedChangesBlocker />
      {isMobileSidebarOpen && <div className="sidebar-backdrop" onClick={() => setIsMobileSidebarOpen(false)} />}
      <div className={"sidebar" + (isMobileSidebarOpen ? " sidebar-open" : "")}>
        <div className="brand">
          <div className="brand-mark"><span className="brand-mark-needle" style={{ background: "#B98B4E" }} /></div>
          <div>
            <div className="brand-name">{t("common.brandName")}</div>
            <div className="brand-sub">{activeCompany?.shortName || activeCompany?.name || t("nav.noCompanySelected")}</div>
          </div>
          <button
            className="sidebar-close-btn"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-label={t("nav.closeMenu")}
          >✕</button>
        </div>

        <CompanySwitcher companies={real.companies} companyId={real.companyId} setCompanyId={real.setCompanyId} />

        <div className="sidebar-nav-scroll">
          <div className="nav-list">
            <Link className={"nav-btn nav-home" + (location.pathname.startsWith("/dashboard") ? " active" : "")} to={routes.dashboard()}>
              <span className="nav-icon"><NavIcon name="dashboard" /></span>
              <span>{t("nav.dashboard")}</span>
            </Link>
          </div>

          <div className="nav-list">
            {visibleNavGroups.map((g) => {
              const isActiveModule = activeGroupId === g.id;
              const isOpen = openGroupId === g.id;
              const badgeCount = navBadges[g.id] || 0;
              return (
                <div className="nav-group" key={g.id}>
                  <Link
                    className={"nav-group-toggle" + (isActiveModule ? " active" : "")}
                    to={g.to()}
                    onClick={(e) => handleGroupClick(e, g.id)}
                  >
                    <span className="nav-icon"><NavIcon name={g.id} /></span>
                    <span className="nav-label">{t(g.labelKey)}</span>
                    {badgeCount > 0 && (
                      <span className={"nav-badge " + (g.id === "sales" ? "nav-badge-danger" : "nav-badge-warning")}>{badgeCount}</span>
                    )}
                    <span className={"nav-caret" + (isOpen ? " open" : "")}>▾</span>
                  </Link>
                  <div className={"nav-subitems-wrap" + (isOpen ? " open" : "")}>
                    <div className="nav-subitems-inner">
                      <div className="nav-subitems">
                        {g.tabs.map((tab) => (
                          <Link
                            key={tab.id}
                            to={g.to(tab.id)}
                            className={"nav-subitem" + (isActiveModule && location.pathname === g.to(tab.id) ? " active" : "")}
                          >
                            <span className="nav-icon nav-icon-sm"><NavIcon name={tab.id} /></span>
                            <span>{t(tab.labelKey)}</span>
                          </Link>
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
          <QuickSearch companyId={real.companyId} />
          <span className="topbar-date">{formatDate(new Date(), i18n.language)}</span>
          <NotificationBell overdueInvoicesCount={overdueInvoicesCount} pendingLeaveCount={pendingLeaveCount} />
          <LanguageSwitcher />
          <UserMenu
            name={user?.name}
            email={user?.email}
            onOpenProfile={() => navigate(routes.settings("profile"))}
            onLogout={async () => { await logout(); navigate("/login"); }}
          />
        </div>

        <div className="app-content">
          <div className="app-content-inner">
            {platformNotices?.map((notice) => (
              <div key={notice.id} className="platform-notice-banner">{notice.message}</div>
            ))}
            {!emailServiceConfigured && (user?.role === "admin" || user?.role === "super_admin") && (
              <div className="system-warning-banner">
                {t("nav.emailWarningBefore")} <code>RESEND_API_KEY</code> {t("nav.emailWarningAfter")}
              </div>
            )}
            {user?.readOnly && (
              <div className="system-warning-banner">{t("nav.readOnlyWarning")}</div>
            )}
            <Outlet context={outletContext} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardRoute() {
  const { companies, companyId } = useOutletContext();
  return <Dashboard companies={companies} companyId={companyId} />;
}
function SalesRoute() {
  const { companies, companyId, reloadRealCompanies } = useOutletContext();
  return <SalesWiredModule companies={companies} companyId={companyId} reloadCompanies={reloadRealCompanies} />;
}
function PurchasesRoute() {
  const { companies, companyId } = useOutletContext();
  return <PurchasesWiredModule companies={companies} companyId={companyId} />;
}
function InventoryRoute() {
  const { companies, companyId } = useOutletContext();
  return <InventoryWiredModule companies={companies} companyId={companyId} />;
}
function StablesRoute() {
  const { companies, companyId } = useOutletContext();
  const company = companies.find((item) => item.id === companyId);
  if (company?.businessActivity !== "horse_stables") return <Navigate to={routes.dashboard()} replace />;
  return <StablesModule companyId={companyId} />;
}
function FixedAssetsRoute() {
  const { companies, companyId } = useOutletContext();
  return <FixedAssetsWiredModule companies={companies} companyId={companyId} />;
}
function AccountsRoute() {
  const { realCompanies, companyId, legacyEntries, legacySales, legacyCompanyId } = useOutletContext();
  return (
    <AccountsGroupModule
      realCompanies={realCompanies} realCompanyId={companyId}
      legacyEntries={legacyEntries} legacySales={legacySales} legacyCompanyId={legacyCompanyId}
    />
  );
}
function HrRoute() {
  const { companies, companyId } = useOutletContext();
  return <HRWiredModule companies={companies} companyId={companyId} />;
}
function ReportsRoute() {
  const { companies, companyId } = useOutletContext();
  return <ReportsModule companies={companies} companyId={companyId} />;
}
function SettingsRoute() {
  const ctx = useOutletContext();
  return (
    <SettingsModule
      currentUser={ctx.currentUser} setCurrentUser={ctx.setCurrentUser}
      jobTitles={ctx.jobTitles} setJobTitles={ctx.setJobTitles}
      companyDocuments={ctx.companyDocuments} setCompanyDocuments={ctx.setCompanyDocuments}
      onDataChange={ctx.onDataChange}
      realCompanies={ctx.realCompanies} reloadRealCompanies={ctx.reloadRealCompanies} onRealCompanyCreated={ctx.onRealCompanyCreated}
    />
  );
}

function ProtectedLayout() {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <AppShell />;
}

// يقرأ رمز إعادة تعيين كلمة المرور من رابط الإيميل مرة واحدة فقط عند أول تحميل الوحدة (نطاق
// الوحدة، وليس داخل useState lazy initializer) — لأن React.StrictMode يستدعي دوال التهيئة الكسولة
// مرتين في وضع التطوير، وهذه الدالة تحمل عرَضاً جانبياً حقيقياً (history.replaceState يزيل الرمز
// من شريط العنوان)؛ لو نُفِّذت داخل useState، الاستدعاء الثاني يقرأ رابطاً أُفرِغ من الرمز بالفعل.
// يعمل فقط على المسار الجذر "/" (تنسيق الرابط الفعلي من mailer.ts: `${FRONTEND_BASE_URL}/?token=`).
function readAndConsumeResetToken() {
  if (window.location.pathname !== "/") return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) window.history.replaceState(null, "", "/");
  return token;
}
const initialResetToken = readAndConsumeResetToken();

function RootRoute() {
  const { isAuthenticated, initializing } = useAuth();
  const navigate = useNavigate();
  const [resetToken, setResetToken] = useState(initialResetToken);

  // شاشة إعادة تعيين كلمة المرور تُعرض بصرف النظر عن وجود جلسة مفتوحة بالفعل في هذا المتصفح —
  // المستخدم قد يضغط رابط الاستعادة على جهاز فيه جلسة أخرى غير متصلة بالحساب المقصود.
  if (resetToken) {
    return (
      <ResetPasswordPage
        token={resetToken}
        onGoLogin={() => { setResetToken(null); navigate("/login"); }}
        onGoForgotPassword={() => { setResetToken(null); navigate("/forgot-password"); }}
      />
    );
  }

  if (initializing) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <LandingPage onGoLogin={() => navigate("/login")} onGoRegister={() => navigate("/register")} />;
}

function LoginRoute() {
  const navigate = useNavigate();
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return (
    <LoginPage
      onGoLanding={() => navigate("/")}
      onGoRegister={() => navigate("/register")}
      onGoForgotPassword={() => navigate("/forgot-password")}
    />
  );
}

function RegisterRoute() {
  const navigate = useNavigate();
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <RegisterPage onGoLanding={() => navigate("/")} onGoLogin={() => navigate("/login")} />;
}

function ForgotPasswordRoute() {
  const navigate = useNavigate();
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <ForgotPasswordPage onGoLogin={() => navigate("/login")} />;
}

function AcceptInviteRoute() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  // بمجرد نجاح تفعيل الدعوة يُسجَّل الدخول تلقائياً (isAuthenticated يصبح true) فتُنقَل الجلسة
  // مباشرة للتطبيق الرئيسي بلا أي تنقّل يدوي إضافي.
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <AcceptInvitePage token={searchParams.get("token")} onGoLogin={() => navigate("/login")} />;
}

// مسار معزول تماماً عن ProtectedLayout/AppShell — معاينة تجريبية لغلاف واجهة جديد (AtharShell)
// على شاشة واحدة فقط (لوحة القيادة)، بلا أي أثر على المسار الحقيقي /dashboard أو أي مسار آخر.
// راجع AtharShellDashboardPilot.jsx للتفاصيل الكاملة.
function AtharShellPreviewRoute() {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <AtharShellDashboardPilot />;
}

// امتداد ثانٍ لنفس المعاينة المعزولة (بعد لوحة القيادة): وحدة المبيعات مُغلَّفة بهيكل أثر الجديد.
// راجع AtharShellSalesPilot.jsx للتفاصيل الكاملة.
function AtharShellSalesPreviewRoute() {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <AtharShellSalesPilot />;
}

const router = createBrowserRouter([
  { path: "/", element: <RootRoute /> },
  { path: "/login", element: <LoginRoute /> },
  { path: "/register", element: <RegisterRoute /> },
  { path: "/forgot-password", element: <ForgotPasswordRoute /> },
  { path: "/accept-invite", element: <AcceptInviteRoute /> },
  { path: "/journal-entries/:id/view", element: <JournalEntryStandalonePage /> },
  { path: "/ui-preview/dashboard", element: <AtharShellPreviewRoute /> },
  { path: "/ui-preview/sales", element: <Navigate to="/ui-preview/sales/invoices" replace /> },
  { path: "/ui-preview/sales/:tab", element: <AtharShellSalesPreviewRoute /> },
  {
    element: <ProtectedLayout />,
    children: [
      { path: "dashboard", element: <DashboardRoute /> },
      { path: "sales", element: <Navigate to={routes.sales()} replace /> },
      { path: "sales/:tab", element: <SalesRoute /> },
      { path: "purchases", element: <Navigate to={routes.purchases()} replace /> },
      { path: "purchases/:tab", element: <PurchasesRoute /> },
      { path: "inventory", element: <Navigate to={routes.inventory()} replace /> },
      { path: "inventory/:tab", element: <InventoryRoute /> },
      { path: "stables", element: <Navigate to={routes.stables()} replace /> },
      { path: "stables/:tab", element: <StablesRoute /> },
      { path: "fixedAssets", element: <Navigate to={routes.fixedAssets()} replace /> },
      { path: "fixedAssets/:tab", element: <FixedAssetsRoute /> },
      { path: "accounts", element: <Navigate to={routes.accounts()} replace /> },
      { path: "accounts/:tab", element: <AccountsRoute /> },
      { path: "hr", element: <Navigate to={routes.hr()} replace /> },
      { path: "hr/:tab", element: <HrRoute /> },
      { path: "reports", element: <Navigate to={routes.reports()} replace /> },
      { path: "reports/:tab", element: <ReportsRoute /> },
      { path: "settings", element: <Navigate to={routes.settings()} replace /> },
      { path: "settings/:tab", element: <SettingsRoute /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export default function App() {
  return (
    <UnsavedChangesProvider>
      <RouterProvider router={router} />
    </UnsavedChangesProvider>
  );
}

