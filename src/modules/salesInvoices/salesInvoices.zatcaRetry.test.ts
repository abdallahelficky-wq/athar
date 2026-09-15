import { describe, expect, it } from "vitest";
import { isDueForZatcaAutoRetry } from "./salesInvoices.service";

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
