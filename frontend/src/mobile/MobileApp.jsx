import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEmployeePortalAuth } from "./context/EmployeePortalAuthContext";
import LanguageSwitcher from "../wired/shared/LanguageSwitcher";
import LoginScreen from "./screens/LoginScreen";
import CheckInScreen from "./screens/CheckInScreen";
import LeaveRequestsScreen from "./screens/LeaveRequestsScreen";
import ManagerInboxScreen from "./screens/ManagerInboxScreen";
import StationShiftScreen from "./screens/StationShiftScreen";
import StationMonitorScreen from "./screens/StationMonitorScreen";

function Shell() {
  const { t } = useTranslation();
  const { employee, logout } = useEmployeePortalAuth();
  const TABS = [
    { id: "attendance", label: t("mobile.tabs.attendance"), icon: "⏱" },
    { id: "leave", label: t("mobile.tabs.leave"), icon: "📅" },
  ];
  const tabs = employee?.isManager ? [...TABS, { id: "inbox", label: t("mobile.tabs.inbox"), icon: "📥" }] : TABS;
  const [tab, setTab] = useState("attendance");
  // مستخدم تطبيق المحطات (مستقل عن شئون الموظفين): المشرف ← متابعة المحطات، العامل ← شاشة الوردية. كلٌّ شاشة واحدة هي الرئيسية،
  // بلا حضور ولا إجازات ولا شريط تبويبات. غيره موظف بوابة عادي.
  const isStation = employee?.kind === "station";
  const monitorOnly = isStation && employee.role === "supervisor";
  const stationOnly = isStation && !monitorOnly;
  const single = isStation;

  return (
    <div className="m-app">
      <div className="m-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="m-header-title">{employee?.name}</div>
            <div className="m-header-sub">{isStation ? (employee.stationName || t(monitorOnly ? "mobile.monitor.supervisorSub" : "mobile.portalSubtitle")) : (employee?.jobTitle || t("mobile.portalSubtitle"))}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LanguageSwitcher />
            <button className="m-logout-link" onClick={logout}>{t("mobile.logoutBtn")}</button>
          </div>
        </div>
      </div>
      <div className="m-main">
        {monitorOnly && <StationMonitorScreen />}
        {stationOnly && <StationShiftScreen />}
        {!single && tab === "attendance" && <CheckInScreen />}
        {!single && tab === "leave" && <LeaveRequestsScreen />}
        {!single && tab === "inbox" && employee?.isManager && <ManagerInboxScreen />}
      </div>
      {!single && <div className="m-tabbar">
        {tabs.map((tabItem) => (
          <button key={tabItem.id} className={"m-tab" + (tab === tabItem.id ? " active" : "")} onClick={() => setTab(tabItem.id)}>
            <span className="m-tab-icon">{tabItem.icon}</span>
            <span>{tabItem.label}</span>
          </button>
        ))}
      </div>}
    </div>
  );
}

export default function MobileApp() {
  const { isAuthenticated, initializing } = useEmployeePortalAuth();
  if (initializing) return null;
  if (!isAuthenticated) return <LoginScreen />;
  return <Shell />;
}
