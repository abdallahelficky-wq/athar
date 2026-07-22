const ACCESS_KEY = "athar.accessToken";
const REFRESH_KEY = "athar.refreshToken";

let accessToken = localStorage.getItem(ACCESS_KEY) || null;
let refreshToken = localStorage.getItem(REFRESH_KEY) || null;

const listeners = new Set();

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  return refreshToken;
}

export function setTokens(next) {
  accessToken = next.accessToken;
  refreshToken = next.refreshToken;
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  listeners.forEach((fn) => fn());
}

/** يُستدعى عندما تُبطَل الجلسة قسراً (فشل تجديد الرمز) — تستمع له AuthContext لتسجيل الخروج فعلياً */
export function onForcedLogout(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
