import { getAccessToken, getRefreshToken, setTokens, clearTokens } from "./tokenStore";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function rawRequest(path, options, accessToken) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || "حدث خطأ غير متوقع", data?.details);
  }
  return data;
}

let refreshPromise = null;

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new ApiError(401, "لا توجد جلسة نشطة");

  if (!refreshPromise) {
    refreshPromise = rawRequest("/auth/refresh", { method: "POST", body: { refreshToken } }, null)
      .then((tokens) => {
        setTokens(tokens);
        return tokens;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * طلب API عام: يرفق access token تلقائياً، ويحاول تجديد الرمز مرة واحدة عند 401
 * ثم يعيد المحاولة. إن فشل التجديد يُبطِل الجلسة بالكامل (clearTokens يُنبّه AuthContext).
 */
export async function apiFetch(path, options = {}) {
  const accessToken = getAccessToken();
  try {
    return await rawRequest(path, options, accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && getRefreshToken()) {
      try {
        const tokens = await refreshAccessToken();
        return await rawRequest(path, options, tokens.accessToken);
      } catch {
        clearTokens();
        throw err;
      }
    }
    throw err;
  }
}

export const api = {
  get: (path) => apiFetch(path, { method: "GET" }),
  post: (path, body) => apiFetch(path, { method: "POST", body }),
  patch: (path, body) => apiFetch(path, { method: "PATCH", body }),
  delete: (path) => apiFetch(path, { method: "DELETE" }),
};
