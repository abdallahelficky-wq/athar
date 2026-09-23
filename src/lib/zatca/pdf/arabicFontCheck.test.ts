import { describe, expect, it, vi } from "vitest";

// عطل صامت أخطر من "مربّعات فارغة" أثبتناه تجريبياً أثناء مراجعة فرع fix/pdf-chromium-production:
// حاوية بها Chromium يعمل بنجاح تام لكن بلا أي خط يغطي العربية تُنتِج صفحة PDF بيضاء تماماً —
// صالحة تقنياً، بلا أي نص مرئي، بلا أي خطأ. renderHtmlToPdf وحدها لا تكتشف هذا (لا ترمي). هذا
// الملف يختبر hasArabicCapableFont فقط (فحص fc-list :lang=ar المنفصل) — راجع server.ts لكيفية
// استخدامه كتحذير إقلاع مستقل عن فحص Chromium العام.
const execFileMock = vi.fn();
vi.mock("child_process", () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

function mockExecFileResult(stdout: string) {
  execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, { stdout, stderr: "" }));
}
function mockExecFileError(err: Error) {
  execFileMock.mockImplementation((_cmd, _args, cb) => cb(err));
}

describe("hasArabicCapableFont", () => {
  it("returns true when fc-list :lang=ar prints at least one matching font", async () => {
    mockExecFileResult("/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf: Noto Naskh Arabic:style=Regular\n");
    const { hasArabicCapableFont } = await import("./arabicFontCheck");
    expect(await hasArabicCapableFont()).toBe(true);
  });

  it("returns false when fc-list :lang=ar succeeds but prints nothing (no Arabic-capable font installed)", async () => {
    mockExecFileResult("");
    const { hasArabicCapableFont } = await import("./arabicFontCheck");
    expect(await hasArabicCapableFont()).toBe(false);
  });

  it("returns false (not throw) when fc-list itself isn't installed — no optimistic assumption without evidence", async () => {
    mockExecFileError(Object.assign(new Error("spawn fc-list ENOENT"), { code: "ENOENT" }));
    const { hasArabicCapableFont } = await import("./arabicFontCheck");
    await expect(hasArabicCapableFont()).resolves.toBe(false);
  });
});
