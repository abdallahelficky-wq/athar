import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../httpError";

// عطل إنتاج فعلي مؤكَّد: CHROMIUM_EXECUTABLE_PATH غير مضبوط في الإنتاج، وكانت كل مسارات توليد
// PDF (تحميل سند القيد، إرفاق PDF عند إرسال كل فاتورة مبيعات بالإيميل تلقائياً، عقد إيواء الخيل)
// تفشل برسالة "خطأ داخلي في الخادم" العامة — لا شيء يخبر أي طرف (مستخدم أو حتى مطوّراً يقرأ رد
// الـ API مباشرة) أن السبب إعداد خادم ناقص لا خطأ عابر. نُموِّه env هنا بدل الاعتماد على غياب
// المتغيّر فعلياً في بيئة الاختبار (قد يُضبَط مستقبلاً)، لاختبار هذا الفرع تحديداً بثبات.
vi.mock("../../../config/env", () => ({ env: { chromiumExecutablePath: undefined } }));

describe("renderHtmlToPdf", () => {
  it("rejects with a classified 503 service-unavailable error (not a generic Error), before ever launching a browser, when Chromium isn't configured", async () => {
    const { renderHtmlToPdf } = await import("./renderPdf");
    await expect(renderHtmlToPdf("<html><body>test</body></html>")).rejects.toMatchObject({ status: 503 });
  });

  it("names the real problem (server configuration, PDF engine) rather than a generic internal-error message", async () => {
    const { renderHtmlToPdf } = await import("./renderPdf");
    try {
      await renderHtmlToPdf("<html><body>test</body></html>");
      throw new Error("expected renderHtmlToPdf to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).message).toMatch(/PDF/);
      expect((err as HttpError).message).not.toBe("خطأ داخلي في الخادم");
    }
  });
});
