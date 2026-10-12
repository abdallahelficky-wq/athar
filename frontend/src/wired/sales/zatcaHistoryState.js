/**
 * حالة لوحة سجل زاتكا (ZatcaHistoryPanel) — دالة بحتة بلا React حتى تُختبَر (src/lib/zatca/zatcaHistoryPanelState.test.ts).
 * اللوحة لا تُرسَم فارغة أبداً: إما تحميل، أو خطأ صريح بكود HTTP، أو "لا توجد محاولات مسجّلة"، أو البيانات.
 * زر إعادة الإصدار يأتي من الخادم (history.reissue — reissueEligibility في src/lib/zatca/reissue.ts)، لا من شرط في الواجهة؛
 * ولمستند مرفوض غير مؤهَّل يُعرَض السبب بدل غياب الزر بصمت.
 *
 * @param {{ loading: boolean, error: { status?: number, message?: string } | null, history: any, zatcaStatus?: string }} s
 */
export function zatcaHistoryView({ loading, error, history, zatcaStatus }) {
  if (loading && !history) return { kind: "loading" };
  if (error) {
    const status = typeof error.status === "number" && error.status > 0 ? error.status : null;
    return { kind: "error", status, message: error.message || "" };
  }
  const issues = Array.isArray(history?.issues) ? history.issues : [];
  const attempts = Array.isArray(history?.attempts) ? history.attempts : [];
  const reissue = history?.reissue;
  const showReissue = Boolean(reissue && reissue.eligible === true);
  const reissueBlockedReason = !showReissue && zatcaStatus === "rejected" && reissue?.reason ? reissue.reason : null;
  return { kind: issues.length || attempts.length ? "data" : "empty", issues, attempts, showReissue, reissueBlockedReason };
}

/** هل تُعرَض اللوحة لهذا المستند أصلاً — كل مستند دخل سلسلة زاتكا أو له حالة زاتكا فعلية؛ لا لمستند لا تنطبق عليه زاتكا */
export function shouldShowZatcaHistory(document) {
  return Boolean(document && document.status !== "draft" && document.zatcaStatus && document.zatcaStatus !== "not_applicable");
}
