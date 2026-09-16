import { describe, expect, it } from "vitest";
import { normalizeSupplyDate } from "./pos.service";

// اختبار وحدة بحت — normalizeSupplyDate لا تلمس Prisma إطلاقاً، فقط تقارن تواريخ وترمي HttpError.
describe("normalizeSupplyDate", () => {
  const ISSUE_DATE = new Date("2026-09-15T14:30:00.000Z"); // وقت إصدار حقيقي بمنتصف اليوم عمداً
  const COMPANY = { fiscalYearClosingDate: null, posSupplyDateMaxBackdatingDays: 3 };

  it("defaults to the issue date itself when no supply date is given at all", () => {
    expect(normalizeSupplyDate(undefined, ISSUE_DATE, COMPANY)).toBe(ISSUE_DATE);
  });

  it("returns the original issueDate object (not a reconstructed one) when the supply date equals today", () => {
    const todaySameDay = new Date("2026-09-15T08:00:00.000Z"); // نفس اليوم، وقت مختلف
    expect(normalizeSupplyDate(todaySameDay, ISSUE_DATE, COMPANY)).toBe(ISSUE_DATE);
  });

  it("accepts a supply date 1-3 days back (within the default limit)", () => {
    const oneDayBack = new Date("2026-09-14T00:00:00.000Z");
    const result = normalizeSupplyDate(oneDayBack, ISSUE_DATE, COMPANY);
    expect(result.toISOString().slice(0, 10)).toBe("2026-09-14");

    const threeDaysBack = new Date("2026-09-12T00:00:00.000Z");
    expect(() => normalizeSupplyDate(threeDaysBack, ISSUE_DATE, COMPANY)).not.toThrow();
  });

  it("rejects a supply date more than the configured max days back", () => {
    const fourDaysBack = new Date("2026-09-11T00:00:00.000Z");
    expect(() => normalizeSupplyDate(fourDaysBack, ISSUE_DATE, COMPANY)).toThrow(/لا يمكن أن يسبق تاريخ التوريد/);
  });

  it("respects a company's own configured backdating limit instead of the default", () => {
    const generousCompany = { fiscalYearClosingDate: null, posSupplyDateMaxBackdatingDays: 10 };
    const sevenDaysBack = new Date("2026-09-08T00:00:00.000Z");
    expect(() => normalizeSupplyDate(sevenDaysBack, ISSUE_DATE, generousCompany)).not.toThrow();

    const strictCompany = { fiscalYearClosingDate: null, posSupplyDateMaxBackdatingDays: 0 };
    const oneDayBack = new Date("2026-09-14T00:00:00.000Z");
    expect(() => normalizeSupplyDate(oneDayBack, ISSUE_DATE, strictCompany)).toThrow();
  });

  it("rejects a future supply date outright, regardless of the backdating limit", () => {
    const tomorrow = new Date("2026-09-16T00:00:00.000Z");
    expect(() => normalizeSupplyDate(tomorrow, ISSUE_DATE, COMPANY)).toThrow(/لا يمكن أن يكون تاريخ التوريد في المستقبل/);
  });

  it("rejects a supply date that falls inside a closed fiscal period", () => {
    const closedCompany = { fiscalYearClosingDate: new Date("2026-09-13T00:00:00.000Z"), posSupplyDateMaxBackdatingDays: 3 };
    const insideClosedPeriod = new Date("2026-09-13T00:00:00.000Z"); // يساوي تاريخ الإقفال بالضبط (شامل)
    expect(() => normalizeSupplyDate(insideClosedPeriod, ISSUE_DATE, closedCompany)).toThrow(/فترة مُقفلة/);
  });

  it("falls back to the default 3-day limit when the company record is unavailable", () => {
    const fourDaysBack = new Date("2026-09-11T00:00:00.000Z");
    expect(() => normalizeSupplyDate(fourDaysBack, ISSUE_DATE, null)).toThrow();
  });

  // إعادة إنتاج مباشرة لعطل توقيت كان موجوداً هنا فعلياً: منتقي التاريخ <input type="date"> في
  // متصفح جهاز Sunmi يبني منتصف الليل بتوقيت الجهاز المحلي (KSA UTC+3 عملياً لمندوب ميداني داخل
  // السعودية)، فتحويله لطابع UTC خام يقع فعلياً 21:00 من اليوم UTC السابق — بلا تعويض هذه الإزاحة،
  // اختيار المندوب "اليوم" نفسه (بلا أي تغيير فعلي) كان سيُحسَب خطأً كتراجع يوم كامل.
  it("treats a same-day pick from a KSA-local midnight timestamp as today, not one day back", () => {
    const issueDateAtNoonUtc = new Date("2026-09-15T10:00:00.000Z"); // 13:00 بتوقيت السعودية، نفس اليوم
    const supplyDatePickedAtKsaLocalMidnight = new Date("2026-09-14T21:00:00.000Z"); // منتصف ليل 15 سبتمبر بتوقيت السعودية
    const result = normalizeSupplyDate(supplyDatePickedAtKsaLocalMidnight, issueDateAtNoonUtc, COMPANY);
    expect(result).toBe(issueDateAtNoonUtc); // يجب أن يُعامَل كـ"اليوم نفسه" ويُرجِع issueDate كما هو، لا يوماً مختلفاً
  });

  it("still correctly counts a genuine one-day backdate under the same KSA-offset math", () => {
    const issueDateAtNoonUtc = new Date("2026-09-15T10:00:00.000Z"); // 13:00 بتوقيت السعودية، 15 سبتمبر
    const supplyDateYesterdayKsaLocalMidnight = new Date("2026-09-13T21:00:00.000Z"); // منتصف ليل 14 سبتمبر بتوقيت السعودية
    const result = normalizeSupplyDate(supplyDateYesterdayKsaLocalMidnight, issueDateAtNoonUtc, COMPANY);
    expect(result.toISOString().slice(0, 10)).toBe("2026-09-14");
  });
});
