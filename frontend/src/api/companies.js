import { api } from "./http";

export const listCompanies = () => api.get("/companies");
export const createCompany = (payload) => api.post("/companies", payload);
// «شركة مستقلة»: مستأجر جديد كلياً لنفس هوية المستخدم — لا يُعيد رموز دخول ولا يغيّر الجلسة الحالية
export const createIndependentCompany = (payload) => api.post("/companies/independent", payload);
export const updateCompany = (id, payload) => api.patch(`/companies/${id}`, payload);
// مفتاح "الأرصدة تحتسب المرحَّل فقط" — للمالك وحده
export const setBalancesPostedOnly = (id, enabled) => api.patch(`/companies/${id}/balances-posted-only`, { enabled });
export const setPayrollTotalsFromMonth = (id, month) => api.patch(`/companies/${id}/payroll-totals-from-month`, { month });
// "فتح الإقفال" — تقديم تاريخ إقفال السنة المالية للخلف أو مسحه بالكامل، admin فقط (راجع الرفض
// المقابل لهذه الحالة في updateCompany العادي على الخادم).
export const reopenFiscalClosing = (id, fiscalYearClosingDate) =>
  api.post(`/companies/${id}/fiscal-closing/reopen`, { fiscalYearClosingDate });

export const uploadCompanyLogo = (id, file) => {
  const form = new FormData();
  form.append("file", file);
  return api.postForm(`/companies/${id}/logo`, form);
};

export const extractCompanyDocument = (id, docType, file) => {
  const form = new FormData();
  form.append("docType", docType);
  form.append("file", file);
  return api.postForm(`/companies/${id}/extract-document`, form);
};

// ربط فاتورة (ZATCA) — انظر src/modules/companiesZatca على الخادم
export const getCompanyZatcaStatus = (id) => api.get(`/companies/${id}/zatca`);
export const generateCompanyZatcaCsr = (id, payload) => api.post(`/companies/${id}/zatca/csr`, payload);
export const requestCompanyZatcaCompliance = (id, otp) => api.post(`/companies/${id}/zatca/compliance`, { otp });
export const requestCompanyZatcaProduction = (id) => api.post(`/companies/${id}/zatca/production`, {});
export const setCompanyZatcaEnvironment = (id, environment) => api.patch(`/companies/${id}/zatca/environment`, { environment });
export const resetCompanyZatcaLinkage = (id) => api.delete(`/companies/${id}/zatca`);

// مستندات فحص الامتثال الاصطناعية الستة — انظر src/lib/zatca/complianceAutomation.ts على الخادم.
// stepKey أحد المفاتيح التي يُعيدها getCompanyZatcaComplianceSteps (مثل standard-credit-note-compliant).
export const getCompanyZatcaComplianceSteps = (id) => api.get(`/companies/${id}/zatca/compliance-steps`);
export const runCompanyZatcaComplianceStepTest = (id, stepKey) => api.post(`/companies/${id}/zatca/compliance-steps/${stepKey}/test`, {});
