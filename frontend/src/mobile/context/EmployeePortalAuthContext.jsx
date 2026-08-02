import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as portalApi from "../api/employeePortal";
import {
  getEmployeePortalToken, setEmployeePortalSession, clearEmployeePortalSession, onEmployeePortalForcedLogout,
  getRememberedTenantId,
} from "../api/employeePortalTokenStore";

const EmployeePortalAuthContext = createContext(null);
const PROFILE_KEY = "athar.employeePortal.profile";

function loadStoredProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function EmployeePortalAuthProvider({ children }) {
  const [employee, setEmployee] = useState(loadStoredProfile);
  const [initializing, setInitializing] = useState(true);

  const reset = useCallback(() => {
    setEmployee(null);
    localStorage.removeItem(PROFILE_KEY);
  }, []);

  useEffect(() => {
    if (!getEmployeePortalToken()) {
      reset();
      setInitializing(false);
      return onEmployeePortalForcedLogout(reset);
    }
    portalApi.getMe()
      .then((profile) => {
        setEmployee(profile);
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      })
      .catch(() => {})
      .finally(() => setInitializing(false));
    return onEmployeePortalForcedLogout(reset);
  }, [reset]);

  const login = async (tenantId, phone, pin) => {
    const result = await portalApi.login(tenantId, phone, pin);
    setEmployeePortalSession({ accessToken: result.accessToken, tenantId });
    setEmployee(result.employee);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(result.employee));
    return result;
  };

  const logout = () => {
    clearEmployeePortalSession();
    reset();
  };

  const value = {
    employee,
    isAuthenticated: Boolean(employee && getEmployeePortalToken()),
    initializing,
    rememberedTenantId: getRememberedTenantId(),
    login,
    logout,
  };

  return <EmployeePortalAuthContext.Provider value={value}>{children}</EmployeePortalAuthContext.Provider>;
}

export function useEmployeePortalAuth() {
  const ctx = useContext(EmployeePortalAuthContext);
  if (!ctx) throw new Error("useEmployeePortalAuth يجب أن يُستخدم داخل EmployeePortalAuthProvider");
  return ctx;
}
