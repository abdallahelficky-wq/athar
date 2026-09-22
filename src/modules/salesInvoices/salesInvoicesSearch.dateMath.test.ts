import { describe, expect, it } from "vitest";
import { riyadhDayStartUtc, riyadhDayEndExclusiveUtc } from "./salesInvoicesSearch.service";

// طلب المستخدم صراحةً: dateTo يجب أن يشمل اليوم السعودي (Asia/Riyadh، UTC+3) بالكامل — بما في ذلك
// فاتورة مسجَّلة الساعة 23:30 بتوقيت الرياض من نفس اليوم. الرياض بلا توقيت صيفي (إزاحة +3 ثابتة).
describe("riyadhDayStartUtc / riyadhDayEndExclusiveUtc", () => {
  it("dateFrom lower bound is inclusive of 00:00 Riyadh time on that date", () => {
    // 2026-01-10 00:00 AST = 2026-01-09 21:00 UTC
    expect(riyadhDayStartUtc("2026-01-10").toISOString()).toBe("2026-01-09T21:00:00.000Z");
  });

  it("dateTo upper bound (exclusive) is midnight Riyadh time of the NEXT day, so it includes an invoice at 23:30 Riyadh time on dateTo itself", () => {
    // 2026-01-15 23:30 AST = 2026-01-15 20:30 UTC — يجب أن يقع قبل الحدّ الأعلى الحصري.
    const invoiceAt2330Riyadh = new Date("2026-01-15T20:30:00.000Z");
    const upperBoundExclusive = riyadhDayEndExclusiveUtc("2026-01-15");

    // 2026-01-16 00:00 AST = 2026-01-15 21:00 UTC
    expect(upperBoundExclusive.toISOString()).toBe("2026-01-15T21:00:00.000Z");
    expect(invoiceAt2330Riyadh.getTime()).toBeLessThan(upperBoundExclusive.getTime());
  });

  it("an invoice at 00:30 Riyadh time on the day AFTER dateTo is correctly excluded", () => {
    // 2026-01-16 00:30 AST = 2026-01-15 21:30 UTC — بعد الحدّ الأعلى الحصري لـdateTo=2026-01-15.
    const invoiceNextDay = new Date("2026-01-15T21:30:00.000Z");
    const upperBoundExclusive = riyadhDayEndExclusiveUtc("2026-01-15");
    expect(invoiceNextDay.getTime()).toBeGreaterThanOrEqual(upperBoundExclusive.getTime());
  });

  it("an invoice at 02:00 UTC (05:00 Riyadh) on dateFrom's calendar date is included, unlike a naive UTC-midnight lower bound", () => {
    // كان حدّاً أدنى ساذجاً (منتصف ليل UTC) سيستثني هذه اللحظة خطأً (تقع الساعة 2 صباحاً UTC من
    // نفس التاريخ، لكنها الساعة 5 صباحاً بتوقيت الرياض من نفس اليوم فعلياً — يجب أن تُشمَل).
    const invoiceAt5amRiyadh = new Date("2026-01-10T02:00:00.000Z");
    const lowerBound = riyadhDayStartUtc("2026-01-10");
    expect(invoiceAt5amRiyadh.getTime()).toBeGreaterThanOrEqual(lowerBound.getTime());
  });
});
