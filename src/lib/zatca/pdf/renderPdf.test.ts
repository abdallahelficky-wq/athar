import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../httpError";

// عطل إنتاج فعلي مؤكَّد: CHROMIUM_EXECUTABLE_PATH غير مضبوط في الإنتاج، وكانت كل مسارات توليد
// PDF (تحميل سند القيد، إرفاق PDF عند إرسال كل فاتورة مبيعات بالإيميل تلقائياً، عقد إيواء الخيل)
// تفشل برسالة "خطأ داخلي في الخادم" العامة — لا شيء يخبر أي طرف (مستخدم أو حتى مطوّراً يقرأ رد
// الـ API مباشرة) أن السبب إعداد خادم ناقص لا خطأ عابر.
//
// envMock كائن قابل للتعديل (لا قيمة ثابتة) حتى يمكن تغيير chromiumExecutablePath بين الاختبارات
// بلا حاجة لـvi.doMock/resetModules — resolveExecutablePath في renderPdf.ts تقرأ env.chromiumExecutablePath
// وقت الاستدعاء الفعلي في كل مرة، لا وقت الاستيراد، فتعديل هذا الكائن مباشرة كافٍ ومضمون.
const envMock: { chromiumExecutablePath: string | undefined } = { chromiumExecutablePath: undefined };
vi.mock("../../../config/env", () => ({ env: envMock }));

// المسارات المعروفة (KNOWN_CHROMIUM_PATHS في renderPdf.ts) — راجع فرع fix/pdf-chromium-production:
// نُموِّه fs.existsSync هنا للتحكّم الكامل بأيّ مسار "موجود" في كل اختبار، بلا اعتماد على وجود/غياب
// Chromium فعلياً على جهاز التشغيل الذي يُنفَّذ عليه هذا الاختبار (قد يختلف بين بيئة تطوير وCI).
vi.mock("fs", () => ({ existsSync: vi.fn() }));

// puppeteer.launch حقيقياً غير مطلوب هنا — الهدف اختبار resolveExecutablePath (أي مسار يُختار
// وتحت أي شرط)، لا سلوك Chromium الفعلي (ذاك مغطّى في buildInvoicePdf.test.ts بـChromium حقيقي).
const launchMock = vi.fn();
vi.mock("puppeteer-core", () => ({ default: { launch: (...args: unknown[]) => launchMock(...args) } }));

function fakeBrowser() {
  return {
    newPage: vi.fn().mockResolvedValue({
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(async () => {
  envMock.chromiumExecutablePath = undefined;
  launchMock.mockReset();
  const { existsSync } = await import("fs");
  vi.mocked(existsSync).mockReset().mockReturnValue(false);
});

describe("renderHtmlToPdf", () => {
  it("rejects with a classified 503 service-unavailable error (not a generic Error), before ever launching a browser, when Chromium isn't configured", async () => {
    const { renderHtmlToPdf } = await import("./renderPdf");
    await expect(renderHtmlToPdf("<html><body>test</body></html>")).rejects.toMatchObject({ status: 503 });
    expect(launchMock).not.toHaveBeenCalled();
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

  // عطل fix/pdf-chromium-production بالضبط: CHROMIUM_EXECUTABLE_PATH غير مضبوط إطلاقاً (كما كان
  // فعلياً في الإنتاج)، لكن حزمة chromium مثبَّتة فعلاً في صورة البناء (railpack.json) عند
  // /usr/bin/chromium — يجب أن يُكتشَف هذا المسار تلقائياً بلا حاجة لضبط أي متغيّر بيئة.
  it("falls back to a known Chromium path automatically when CHROMIUM_EXECUTABLE_PATH is unset", async () => {
    const { existsSync } = await import("fs");
    vi.mocked(existsSync).mockImplementation((path) => path === "/usr/bin/chromium");
    launchMock.mockResolvedValue(fakeBrowser());

    const { renderHtmlToPdf } = await import("./renderPdf");
    const pdf = await renderHtmlToPdf("<html><body>test</body></html>");

    expect(pdf).toBeInstanceOf(Buffer);
    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({ executablePath: "/usr/bin/chromium" }));
  });

  // ترتيب المسارات المعروفة مهم: يُفحَص /usr/bin/chromium أولاً، فلا يُستخدَم بديل أقل تفضيلاً لو
  // كان الأول موجوداً بالفعل أيضاً.
  it("prefers the first known path in the list when multiple known paths exist", async () => {
    const { existsSync } = await import("fs");
    vi.mocked(existsSync).mockImplementation((path) => path === "/usr/bin/chromium" || path === "/usr/bin/google-chrome");
    launchMock.mockResolvedValue(fakeBrowser());

    const { renderHtmlToPdf } = await import("./renderPdf");
    await renderHtmlToPdf("<html><body>test</body></html>");

    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({ executablePath: "/usr/bin/chromium" }));
  });

  it("still throws the 503 when CHROMIUM_EXECUTABLE_PATH is unset and none of the known paths exist either", async () => {
    const { renderHtmlToPdf } = await import("./renderPdf");
    await expect(renderHtmlToPdf("<html><body>test</body></html>")).rejects.toMatchObject({ status: 503 });
    expect(launchMock).not.toHaveBeenCalled();
  });

  // CHROMIUM_EXECUTABLE_PATH مضبوط لكن يُشير لمسار لم يعد موجوداً (بالضبط رسالة تحذير الإقلاع في
  // server.ts: "غير مضبوط أو يشير لمسار غير موجود") — يجب أن يقع نفس الاكتشاف التلقائي للمسارات
  // المعروفة، لا رفض فوري لمجرد أن المتغيّر "مضبوط" شكلياً ببيئة قديمة/خاطئة.
  it("ignores a configured path that no longer exists and falls back to a known path instead", async () => {
    envMock.chromiumExecutablePath = "/opt/old-chromium-that-no-longer-exists";
    const { existsSync } = await import("fs");
    vi.mocked(existsSync).mockImplementation((path) => path === "/usr/bin/chromium");
    launchMock.mockResolvedValue(fakeBrowser());

    const { renderHtmlToPdf } = await import("./renderPdf");
    await renderHtmlToPdf("<html><body>test</body></html>");

    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({ executablePath: "/usr/bin/chromium" }));
  });

  it("uses the configured path directly (skips the known-path scan) when it does exist", async () => {
    envMock.chromiumExecutablePath = "/opt/custom-chromium";
    const { existsSync } = await import("fs");
    vi.mocked(existsSync).mockImplementation((path) => path === "/opt/custom-chromium" || path === "/usr/bin/chromium");
    launchMock.mockResolvedValue(fakeBrowser());

    const { renderHtmlToPdf } = await import("./renderPdf");
    await renderHtmlToPdf("<html><body>test</body></html>");

    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({ executablePath: "/opt/custom-chromium" }));
  });
});
