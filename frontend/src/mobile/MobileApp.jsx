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
  // تبويب ورديات المحطة يظهر فقط لموظف مُسنَد لمحطة (Employee.assignedCostCenterId) — نفس مبدأ
  // "inbox" أدناه (يظهر فقط لمدير له مرؤوسون)، بلا أي Position/صلاحية منفصلة.
  if (employee?.assignedCostCenterId) TABS.push({ id: "stationShifts", label: t("mobile.tabs.stationShifts"), icon: "⛽" });
  const tabs = employee?.isManager ? [...TABS, { id: "inbox", label: t("mobile.tabs.inbox"), icon: "📥" }] : TABS;
  const [tab, setTab] = useState("attendance");
  // عامل محطة (مُسنَد لمحطة وليس مديراً): التطبيق شاشة الوردية وحدها — لا حضور ولا إجازات ولا شريط تبويبات؛ هي الصفحة الرئيسية
  // مشرف المحطات: التطبيق شاشة متابعة المحطات وحدها (أيقونة لكل محطة)
  const monitorOnly = Boolean(employee?.stationSupervisor);
  const stationOnly = !monitorOnly && Boolean(employee?.assignedCostCenterId) && !employee?.isManager;
  const single = monitorOnly || stationOnly;

  return (
    <div className="m-app">
      <div className="m-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="m-header-title">{employee?.name}</div>
            <div className="m-header-sub">{employee?.jobTitle || t("mobile.portalSubtitle")}</div>
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
        {!single && tab === "stationShifts" && employee?.assignedCostCenterId && <StationShiftScreen />}
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
