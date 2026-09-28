import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../prisma", () => ({
  prisma: { $transaction: vi.fn(), zatcaDocumentArchive: { create: vi.fn() } },
}));

import { prisma } from "../prisma";
import { ARCHIVE_TX_OPTIONS, saveZatcaResponseWithArchive } from "./archive";

/**
 * مسار حفظ ردّ زاتكا المقبول: الرد يجب أن يُحفَظ في كل حالة فشل (فقدانه = إعادة إرسال بنفس UUID وكسر سلسلة ICV).
 * ما وجده المراجِع: فشل بدء المعاملة/مهلتها كان يُسقِط الأرشيف نهائياً بلا محاولة ثانية.
 */
const payload = { signedXml: "<Invoice/>", subtype: "simplified" as const, icv: 1, invoiceHash: "h", issuedAt: new Date("2026-09-01T00:00:00Z") };
const doc = { tenantId: "t", companyId: "c", documentType: "sales_invoice" as const, documentId: "d", documentNumber: "INV-1", documentUuid: "u" };

describe("saveZatcaResponseWithArchive", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.mocked(prisma.$transaction).mockReset();
    vi.mocked(prisma.zatcaDocumentArchive.create).mockReset();
    log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("passes explicit maxWait/timeout to the transaction", async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue("ok" as never);
    await saveZatcaResponseWithArchive({ payload, doc, source: "submission", inTx: async () => "ok", plain: async () => "plain" });
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toEqual(ARCHIVE_TX_OPTIONS);
  });

  it("transaction cannot start (pool exhausted): the response is saved, then the archive is written in a separate attempt", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(Object.assign(new Error("Unable to start a transaction in the given time."), { code: "P2028" }));
    vi.mocked(prisma.zatcaDocumentArchive.create).mockResolvedValue({} as never);
    const plain = vi.fn().mockResolvedValue("saved-plain");

    const result = await saveZatcaResponseWithArchive({ payload, doc, source: "submission", inTx: async () => "never", plain });

    expect(result).toBe("saved-plain");
    expect(plain).toHaveBeenCalledTimes(1);
    expect(prisma.zatcaDocumentArchive.create).toHaveBeenCalledTimes(1);
    const messages = log.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("[zatca-archive] FAILED at begin"))).toBe(true);
    expect(messages.some((m) => m.includes("[zatca-archive] RECOVERED"))).toBe(true);
  });

  it("archive fails in the transaction and again alone: the response is still saved and the loss is logged, not thrown", async () => {
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) =>
      fn({ zatcaDocumentArchive: { create: vi.fn().mockRejectedValue(new Error("disk full")) } })) as never);
    vi.mocked(prisma.zatcaDocumentArchive.create).mockRejectedValue(new Error("disk full"));
    const plain = vi.fn().mockResolvedValue("saved-plain");

    await expect(saveZatcaResponseWithArchive({ payload, doc, source: "submission", inTx: async () => "in-tx", plain })).resolves.toBe("saved-plain");
    const messages = log.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("FAILED at archive"))).toBe(true);
    expect(messages.some((m) => m.includes("لم يُحفَظ أصل"))).toBe(true);
  });

  it("if the plain save of the response also fails, that error propagates (never swallowed) and no archive is attempted without a saved response", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("db down"));
    const plain = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(saveZatcaResponseWithArchive({ payload, doc, source: "submission", inTx: async () => "x", plain })).rejects.toThrow("db down");
    expect(prisma.zatcaDocumentArchive.create).not.toHaveBeenCalled();
  });

  it("without a production payload the path is unchanged: one plain save, no transaction", async () => {
    const plain = vi.fn().mockResolvedValue("p");
    await saveZatcaResponseWithArchive({ payload: undefined, doc, source: "submission", inTx: async () => "x", plain });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(plain).toHaveBeenCalledTimes(1);
  });
});
