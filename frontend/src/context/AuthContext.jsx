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
    if (!getAccessToken() || !getRefreshToken()) {
      clearTokens();
      reset();
      setInitializing(false);
      return onForcedLogout(reset);
    }
    // نعتمد مبدئياً على بيانات المستخدم/المستأجر المحفوظة محلياً من آخر عملية دخول ناجحة
    // (حتى لا تنتظر الشاشة شبكة قبل أول عرض)، ثم نجلب النسخة الحالية فعلياً من الخادم عبر
    // /auth/me ونحدّث الجلسة المحفوظة بها. هذا ضروري لأن أي تصحيح لاحق لاسم المستأجر أو
    // المستخدم (كإصلاح ترميز خاطئ عبر شاشة الإعدادات) لن ينعكس في جلسة متصفح مفتوحة بالفعل
    // إلا بعد إعادة الجلب هذه — بدونها تبقى الجلسة المفتوحة تعرض القيمة القديمة المخزَّنة
    // محلياً إلى الأبد، حتى لو صُحِّحت البيانات في قاعدة البيانات.
    authApi
      .getMe()
      .then((result) => {
        setUser(result.user);
        setTenant(result.tenant);
        localStorage.setItem(SESSION_KEY, JSON.stringify({ user: result.user, tenant: result.tenant }));
      })
      .catch(() => {
        // فشل الجلب (رمز منتهي مثلاً) — onForcedLogout سيتكفّل بإنهاء الجلسة عند الحاجة
      })
      .finally(() => setInitializing(false));
    return onForcedLogout(reset);
  }, [reset]);

  useEffect(() => {
    // عند استعادة الصفحة من ذاكرة التصفح الخلفية (bfcache) بزر الرجوع في المتصفح، تُستعاد شجرة
    // React وحالتها القديمة كما كانت مجمّدة في الذاكرة دون إعادة تشغيل أي useEffect — أي أنه لو
    // كانت الصفحة معروضة أثناء الجلسة قبل تسجيل الخروج، سيظهر لحظياً آخر ما كان مرسوماً على
    // الشاشة (بيانات محمية) قبل أي محاولة لإعادة التحقق. إعادة تحميل الصفحة بالكامل هنا تضمن شجرة
    // React جديدة تتحقق من وجود الرمز الحالي فعلياً بدل استعادة عرض قديم من الذاكرة.
    const onPageShow = (event) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

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

  const renameMe = async (name) => {
    const { user: updated } = await authApi.updateMyName(name);
    setUser(updated);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: updated, tenant }));
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
    renameMe,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth يجب أن يُستخدم داخل AuthProvider");
  return ctx;
}
