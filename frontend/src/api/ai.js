import { api } from "./http";

const withCompany = (path, companyId) => (companyId ? `${path}?companyId=${encodeURIComponent(companyId)}` : path);

/** محادثة: history = آخر أدوار {role, content}. النطاق (المستأجر/الشركة) يُشتَق في الخادم من الرمز. */
export const askAi = (question, { companyId, history } = {}) =>
  api.post("/ai/ask", { question, ...(companyId ? { companyId } : {}), ...(history?.length ? { history } : {}) });
export const getAiInsights = (companyId) => api.post("/ai/insights", companyId ? { companyId } : {});
/** توقعات وشذوذ حتمية — بلا نموذج لغوي. */
export const getAiSignals = (companyId) => api.get(withCompany("/ai/signals", companyId));
