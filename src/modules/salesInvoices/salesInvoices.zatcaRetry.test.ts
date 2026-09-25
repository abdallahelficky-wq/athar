import { describe, expect, it } from "vitest";
import { allocateZatcaAutoRetryBatch, isDueForZatcaAutoRetry } from "./salesInvoices.service";

// اختبار وحدة بحت لمنطق الـbackoff بلا أي اتصال بقاعدة بيانات — الدالة المُختبَرة هنا لا تلمس
// Prisma إطلاقاً، فقط تقارن طوابع زمنية. الاختبارات الأخرى لهذه الوحدة (الاستعلام الفعلي عن
// الفواتير المستحقة وإعادة إرسالها) تحتاج Postgres حقيقياً ولم تُكتَب بعد — راجع الملاحظة في
// التقرير المرفق حول عدم توفر قاعدة بيانات في بيئة التطوير هذه.
describe("isDueForZatcaAutoRetry", () => {
  const NOW = new Date("2026-09-15T12:00:00.000Z");

  it("is due immediately when the invoice has never been auto-retried before (lastAttemptAt is null)", () => {
    expect(isDueForZatcaAutoRetry({ zatcaRetryCount: 0, zatcaLastAttemptAt: null }, NOW)).toBe(true);
  });

  it("is not due yet right after a first retry attempt (needs 5 minutes before the second)", () => {
    const lastAttemptAt = new Date(NOW.getTime() - 4 * 60 * 1000); // قبل 4 دقائق فقط
    expect(isDueForZatcaAutoRetry({ zatcaRetryCount: 1, zatcaLastAttemptAt: lastAttemptAt }, NOW)).toBe(false);
  });

  it("becomes due once the 5-minute backoff after the first retry has elapsed", () => {
    const lastAttemptAt = new Date(NOW.getTime() - 5 * 60 * 1000);
    expect(isDueForZatcaAutoRetry({ zatcaRetryCount: 1, zatcaLastAttemptAt: lastAttemptAt }, NOW)).toBe(true);
  });

  it("backs off progressively as the retry count climbs (15 then 30 then 60 minutes)", () => {
    const fifteenMinAgo = new Date(NOW.getTime() - 15 * 60 * 1000);
    expect(isDueForZatcaAutoRetry({ zatcaRetryCount: 2, zatcaLastAttemptAt: fifteenMinAgo }, NOW)).toBe(true);
    expect(isDueForZatcaAutoRetry({ zatcaRetryCount: 2, zatcaLastAttemptAt: new Date(NOW.getTime() - 14 * 60 * 1000) }, NOW)).toBe(false);

    const thirtyMinAgo = new Date(NOW.getTime() - 30 * 60 * 1000);
    expect(isDueForZatcaAutoRetry({ zatcaRetryCount: 3, zatcaLastAttemptAt: thirtyMinAgo }, NOW)).toBe(true);
  });

  it("caps backoff at 60 minutes no matter how many times it has already failed (never hammers ZATCA)", () => {
    const fiftyNineMinAgo = new Date(NOW.getTime() - 59 * 60 * 1000);
    const sixtyMinAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(isDueForZatcaAutoRetry({ zatcaRetryCount: 50, zatcaLastAttemptAt: fiftyNineMinAgo }, NOW)).toBe(false);
    expect(isDueForZatcaAutoRetry({ zatcaRetryCount: 50, zatcaLastAttemptAt: sixtyMinAgo }, NOW)).toBe(true);
  });
});

// اختبار وحدة بحت أيضاً — لا يلمس Prisma، فقط منطق تجميع/تناوب بحت على مصفوفات في الذاكرة.
describe("allocateZatcaAutoRetryBatch", () => {
  function invoice(companyId: string, invoiceNumber: string) {
    return { companyId, invoiceNumber };
  }

  it("does not let one company's large backlog crowd out another company's single invoice", () => {
    // شركة A لديها 30 فاتورة متأخرة (أقدم من فاتورة B)، شركة B لديها فاتورة واحدة فقط.
    const dueOldestFirst = [
      ...Array.from({ length: 30 }, (_, i) => invoice("company-A", `A-${i}`)),
      invoice("company-B", "B-1"),
    ];
    const batch = allocateZatcaAutoRetryBatch(dueOldestFirst, 5);
    // لو مُلئت الدفعة من الأقدم على الإطلاق بلا تمييز، فاتورة B لن تظهر إطلاقاً هذه النبضة.
    expect(batch.some((inv) => inv.companyId === "company-B")).toBe(true);
    expect(batch.filter((inv) => inv.companyId === "company-A")).toHaveLength(4);
  });

  it("keeps oldest-first order within each company's own queue", () => {
    const dueOldestFirst = [invoice("company-A", "A-1"), invoice("company-A", "A-2"), invoice("company-A", "A-3")];
    const batch = allocateZatcaAutoRetryBatch(dueOldestFirst, 2);
    expect(batch.map((inv) => inv.invoiceNumber)).toEqual(["A-1", "A-2"]);
  });

  it("gives every company with pending work exactly one slot per round when companies outnumber the batch size", () => {
    const dueOldestFirst = ["A", "B", "C", "D", "E"].map((c) => invoice(c, `${c}-1`));
    const batch = allocateZatcaAutoRetryBatch(dueOldestFirst, 3);
    expect(batch).toHaveLength(3);
    expect(new Set(batch.map((inv) => inv.companyId)).size).toBe(3); // 3 شركات مختلفة، لا نفس الشركة مرتين
  });

  it("rotates which companies get priority across ticks so the same ones don't starve when companies exceed the batch size", () => {
    const dueOldestFirst = ["A", "B", "C", "D", "E"].map((c) => invoice(c, `${c}-1`));
    const firstTick = allocateZatcaAutoRetryBatch(dueOldestFirst, 2, 0).map((inv) => inv.companyId);
    const secondTick = allocateZatcaAutoRetryBatch(dueOldestFirst, 2, 2).map((inv) => inv.companyId);
    expect(firstTick).toEqual(["A", "B"]);
    expect(secondTick).toEqual(["C", "D"]);
  });

  it("returns an empty batch when nothing is due", () => {
    expect(allocateZatcaAutoRetryBatch([], 20)).toEqual([]);
  });
});
