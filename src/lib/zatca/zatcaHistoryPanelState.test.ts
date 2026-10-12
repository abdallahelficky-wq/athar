import path from "path";
import { describe, expect, it } from "vitest";

/**
 * حالات لوحة سجل زاتكا (frontend/src/wired/sales/zatcaHistoryState.js) — اللوحة لا تُرسَم فارغة أبداً. قبل الإصلاح كان أي خطأ في
 * جلب السجل (403/404/500/انقطاع) يُبتلَع إلى قائمتين فارغتين، فتختفي اللوحة أو تبدو بلا محتوى، وكان زر إعادة الإصدار شرطاً في
 * الواجهة (pending_submission فقط) يخالف ما يقبله الخادم. السجل نفسه يأتي في الاختبار التكاملي من الخادم الحقيقي
 * (legacyRejectedReissue.integration.test.ts)؛ هنا حالات الواجهة وحدها.
 */
type View = { kind: string; status?: number | null; message?: string; showReissue?: boolean; reissueBlockedReason?: string | null };
const load = async () =>
  (await import(path.resolve("frontend/src/wired/sales/zatcaHistoryState.js") as string)) as {
    zatcaHistoryView: (s: { loading: boolean; error: { status?: number; message?: string } | null; history: unknown; zatcaStatus?: string }) => View;
    shouldShowZatcaHistory: (d: unknown) => boolean;
  };

const attempt = { id: "a1", outcome: "rejected" };
const issue = { id: "i1", icv: 202 };

describe("ZATCA history panel — never an empty container", () => {
  it("loading → an explicit loading state", async () => {
    const { zatcaHistoryView } = await load();
    expect(zatcaHistoryView({ loading: true, error: null, history: null }).kind).toBe("loading");
  });

  it("an HTTP error keeps its status and message (403, 404, 500), a network failure has none", async () => {
    const { zatcaHistoryView } = await load();
    for (const status of [403, 404, 500]) {
      expect(zatcaHistoryView({ loading: false, error: { status, message: "رسالة الخادم" }, history: null })).toEqual({ kind: "error", status, message: "رسالة الخادم" });
    }
    expect(zatcaHistoryView({ loading: false, error: { message: "Failed to fetch" }, history: null })).toEqual({ kind: "error", status: null, message: "Failed to fetch" });
    // خطأ بعد سجل سابق محمَّل لا يُخفى خلف البيانات القديمة
    expect(zatcaHistoryView({ loading: false, error: { status: 500 }, history: { issues: [issue], attempts: [attempt] } }).kind).toBe("error");
  });

  it("no rows → an explicit empty state, still offering re-issue when the server says it is eligible", async () => {
    const { zatcaHistoryView } = await load();
    expect(zatcaHistoryView({ loading: false, error: null, history: { issues: [], attempts: [], reissue: { eligible: false, reason: "x" } }, zatcaStatus: "not_submitted" }))
      .toMatchObject({ kind: "empty", showReissue: false, reissueBlockedReason: null });
    expect(zatcaHistoryView({ loading: false, error: null, history: { issues: [], attempts: [], reissue: { eligible: true } }, zatcaStatus: "rejected" }))
      .toMatchObject({ kind: "empty", showReissue: true });
    // شكل غير متوقَّع من الخادم لا يُسقط اللوحة
    expect(zatcaHistoryView({ loading: false, error: null, history: {} }).kind).toBe("empty");
  });

  it("re-issue comes from the server; a rejected document that is not eligible shows the reason instead of nothing", async () => {
    const { zatcaHistoryView } = await load();
    const history = { issues: [issue], attempts: [attempt] };
    expect(zatcaHistoryView({ loading: false, error: null, history: { ...history, reissue: { eligible: true } }, zatcaStatus: "rejected" }))
      .toMatchObject({ kind: "data", showReissue: true, reissueBlockedReason: null });
    expect(zatcaHistoryView({ loading: false, error: null, history: { ...history, reissue: { eligible: false, reason: "عميل هذا المستند لم يعد قياسياً" } }, zatcaStatus: "rejected" }))
      .toMatchObject({ kind: "data", showReissue: false, reissueBlockedReason: "عميل هذا المستند لم يعد قياسياً" });
    // مستند مقبول: لا زر ولا سبب (لا ضجيج)
    expect(zatcaHistoryView({ loading: false, error: null, history: { ...history, reissue: { eligible: false, reason: "x" } }, zatcaStatus: "cleared" }))
      .toMatchObject({ showReissue: false, reissueBlockedReason: null });
  });

  it("the panel is mounted for every document in the ZATCA flow, and not for drafts or documents ZATCA does not apply to", async () => {
    const { shouldShowZatcaHistory } = await load();
    expect(shouldShowZatcaHistory({ status: "pending_submission", zatcaStatus: "rejected" })).toBe(true);
    expect(shouldShowZatcaHistory({ status: "posted", zatcaStatus: "rejected" })).toBe(true);
    expect(shouldShowZatcaHistory({ status: "posted", zatcaStatus: "not_submitted" })).toBe(true);
    expect(shouldShowZatcaHistory({ status: "posted", zatcaStatus: "not_applicable" })).toBe(false);
    expect(shouldShowZatcaHistory({ status: "draft", zatcaStatus: "not_submitted" })).toBe(false);
  });
});
