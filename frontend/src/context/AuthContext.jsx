import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as authApi from "../api/auth";
import { getAccessToken, getRefreshToken, setTokens, clearTokens, onForcedLogout } from "../api/tokenStore";

const AuthContext = createContext(null);
const SESSION_KEY = "athar.session"; // { user, tenant } فقط — الرموز نفسها في tokenStore

function loadStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const stored = loadStoredSession();
  const [user, setUser] = useState(stored?.user ?? null);
  const [tenant, setTenant] = useState(stored?.tenant ?? null);
  const [initializing, setInitializing] = useState(true);

  const reset = useCallback(() => {
    setUser(null);
    setTenant(null);
    localStorage.removeItem(SESSION_KEY);
  }, []);

  useEffect(() => {
    // لا يوجد endpoint لجلب "من أنا" في المرحلة صفر، فنعتمد على بيانات المستخدم/المستأجر
    // المحفوظة محلياً من آخر عملية دخول ناجحة؛ لو انتهت صلاحية الرمزين معاً (access + refresh)
    // فإن أول طلب API فاشل بعد إعادة التحميل سيُبطِل الجلسة تلقائياً عبر onForcedLogout.
    if (!getAccessToken() || !getRefreshToken()) {
      clearTokens();
      reset();
    }
    setInitializing(false);
    return onForcedLogout(reset);
  }, [reset]);

  const applySession = (result) => {
    setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    setUser(result.user);
    setTenant(result.tenant);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: result.user, tenant: result.tenant }));
  };

  const login = async (email, password) => {
    const result = await authApi.login({ email, password });
    applySession(result);
    return result;
  };

  const register = async (payload) => {
    const result = await authApi.registerTenant(payload);
    applySession(result);
    return result;
  };

  const renameTenant = async (name) => {
    const { tenant: updated } = await authApi.updateTenantName(name);
    setTenant(updated);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user, tenant: updated }));
    return updated;
  };

  const logout = async () => {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch {
      // نتجاهل فشل تسجيل الخروج من الخادم — المهم مسح الجلسة محلياً بأي حال
    }
    clearTokens();
    reset();
  };

  const value = {
    user,
    tenant,
    setTenant,
    isAuthenticated: Boolean(user && getAccessToken()),
    initializing,
    login,
    register,
    renameTenant,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth يجب أن يُستخدم داخل AuthProvider");
  return ctx;
}
