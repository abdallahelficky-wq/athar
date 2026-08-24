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
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  // لملفات FormData نترك المتصفح يضبط Content-Type بنفسه (يتضمن boundary متعدد الأجزاء)
  if (options.body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body !== undefined ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error || "حدث خطأ غير متوقع", data?.details);
  }
  return data;
}

// نسخة من rawRequest لملفات ثنائية (PDF مثلاً) بدل JSON — نفس منطق إرفاق الرمز، لكن بلا محاولة
// تحويل الجسم لنص/JSON (سيفسد أي محتوى ثنائي). ترجع Blob + اسم الملف المقترَح من رأس
// Content-Disposition إن وُجد (نفس الاسم الذي يضبطه الخادم فعلياً).
async function rawBlobRequest(path, accessToken) {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* الاستجابة ليست JSON (خطأ خادم عام مثلاً) */ }
    throw new ApiError(res.status, data?.error || "حدث خطأ غير متوقع", data?.details);
  }
  const match = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") || "");
  return { blob: await res.blob(), filename: match?.[1] };
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

/** مكافئ apiFetch لكن لملف ثنائي (PDF...) — نفس محاولة تجديد الرمز مرة واحدة عند 401. */
export async function apiFetchBlob(path) {
  const accessToken = getAccessToken();
  try {
    return await rawBlobRequest(path, accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && getRefreshToken()) {
      try {
        const tokens = await refreshAccessToken();
        return await rawBlobRequest(path, tokens.accessToken);
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
  getBlob: (path) => apiFetchBlob(path),
  post: (path, body) => apiFetch(path, { method: "POST", body }),
  postForm: (path, formData) => apiFetch(path, { method: "POST", body: formData }),
  patch: (path, body) => apiFetch(path, { method: "PATCH", body }),
  put: (path, body) => apiFetch(path, { method: "PUT", body }),
  delete: (path, body) => apiFetch(path, { method: "DELETE", body }),
};
