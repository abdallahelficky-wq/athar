import { getEmployeePortalToken, clearEmployeePortalSession } from "./employeePortalTokenStore";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** طلب API لبوابة الموظف — لا تجديد رمز تلقائياً (الرمز صالح أسبوعاً)؛ 401 يُبطل الجلسة فوراً.
 * جسم FormData (رفع صورة) يُترَك للمتصفح ليضبط Content-Type بنفسه (يتضمّن boundary متعدد
 * الأجزاء)، بعكس جسم JSON العادي — نفس أسلوب api/http.js في التطبيق الرئيسي تماماً. */
export async function employeePortalFetch(path, options = {}) {
  const token = getEmployeePortalToken();
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : isFormData ? options.body : JSON.stringify(options.body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    if (res.status === 401) clearEmployeePortalSession();
    throw new ApiError(res.status, data?.error || "حدث خطأ غير متوقع", data?.details);
  }
  return data;
}

export const employeePortalApi = {
  get: (path) => employeePortalFetch(path, { method: "GET" }),
  post: (path, body) => employeePortalFetch(path, { method: "POST", body }),
  postForm: (path, formData) => employeePortalFetch(path, { method: "POST", body: formData }),
  put: (path, body) => employeePortalFetch(path, { method: "PUT", body }),
};
