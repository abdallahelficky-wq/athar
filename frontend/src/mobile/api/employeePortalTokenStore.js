// مخزّن رمز منفصل تماماً عن tokenStore.js الخاص بحسابات User الإدارية — مفتاح تخزين مختلف،
// ولا استيراد مشترك بين هذا الحزمة (bundle بوابة الموظف) وحزمة سطح المكتب إطلاقاً.
const ACCESS_KEY = "athar.employeePortal.accessToken";
const TENANT_KEY = "athar.employeePortal.tenantId";

let accessToken = localStorage.getItem(ACCESS_KEY) || null;
let tenantId = localStorage.getItem(TENANT_KEY) || null;

const listeners = new Set();

export function getEmployeePortalToken() {
  return accessToken;
}

export function getRememberedTenantId() {
  return tenantId;
}

export function setEmployeePortalSession({ accessToken: token, tenantId: tid }) {
  accessToken = token;
  tenantId = tid;
  localStorage.setItem(ACCESS_KEY, token);
  localStorage.setItem(TENANT_KEY, tid);
}

export function clearEmployeePortalSession() {
  accessToken = null;
  localStorage.removeItem(ACCESS_KEY);
  listeners.forEach((fn) => fn());
}

/** رمز البوابة صالح لأسبوع فقط بلا تجديد تلقائي — عند انتهائه أو رفضه تُبطَل الجلسة ويُطلَب دخول جديد */
export function onEmployeePortalForcedLogout(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
