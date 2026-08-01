import React, { useState } from "react";
import { useEmployeePortalAuth } from "./context/EmployeePortalAuthContext";
import LoginScreen from "./screens/LoginScreen";
import CheckInScreen from "./screens/CheckInScreen";
import LeaveRequestsScreen from "./screens/LeaveRequestsScreen";
import ManagerInboxScreen from "./screens/ManagerInboxScreen";

const TABS = [
  { id: "attendance", label: "الحضور", icon: "⏱" },
  { id: "leave", label: "إجازاتي", icon: "📅" },
];

function Shell() {
  const { employee, logout } = useEmployeePortalAuth();
  const tabs = employee?.isManager ? [...TABS, { id: "inbox", label: "طلبات فريقي", icon: "📥" }] : TABS;
  const [tab, setTab] = useState("attendance");

  return (
    <div className="m-app">
      <div className="m-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="m-header-title">{employee?.name}</div>
            <div className="m-header-sub">{employee?.jobTitle || "بوابة الموظف"}</div>
          </div>
          <button className="m-logout-link" onClick={logout}>خروج</button>
        </div>
      </div>
      <div className="m-main">
        {tab === "attendance" && <CheckInScreen />}
        {tab === "leave" && <LeaveRequestsScreen />}
        {tab === "inbox" && employee?.isManager && <ManagerInboxScreen />}
      </div>
      <div className="m-tabbar">
        {tabs.map((t) => (
          <button key={t.id} className={"m-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            <span className="m-tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MobileApp() {
  const { isAuthenticated, initializing } = useEmployeePortalAuth();
  if (initializing) return null;
  if (!isAuthenticated) return <LoginScreen />;
  return <Shell />;
}
