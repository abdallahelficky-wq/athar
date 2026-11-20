import { describe, expect, it } from "vitest";
import { detectSeriesAnomalies, findDuplicateEntries, forecastSeries, median, trimLeadingZeros } from "./financialModel";

const series = (values: number[], start = "2026-01") =>
  values.map((value, i) => {
    const [y, m] = start.split("-").map(Number);
    return { month: new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7), value };
  });

describe("forecastSeries", () => {
  it("returns null with fewer than 3 active months", () => {
    expect(forecastSeries(series([0, 0, 0, 100, 120]))).toBeNull();
  });
  it("extends a rising line with damped slope and rolls month labels over the year end", () => {
    const f = forecastSeries(series([100, 110, 120, 130, 140, 150], "2026-08"), 3)!;
    expect(f.points.map((p) => p.month)).toEqual(["2027-02", "2027-03", "2027-04"]);
    expect(f.points[0].value).toBeGreaterThan(150);
    // التخميد: الزيادة الأولى أقل من ميل 10 كاملاً
    expect(f.points[0].value).toBeLessThan(160);
    expect(f.trendPct).toBeGreaterThan(0);
    expect(f.points.every((p) => p.low <= p.value && p.value <= p.high)).toBe(true);
  });
  it("ignores leading inactive months and reports confidence from active length", () => {
    expect(forecastSeries(series([0, 0, 0, 10, 12, 14]))!.confidence).toBe("low");
    expect(forecastSeries(series([0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))!.confidence).toBe("high");
  });
  it("widens the band with the horizon", () => {
    const f = forecastSeries(series([100, 90, 120, 95, 130, 100, 125]), 3)!;
    const w = f.points.map((p) => p.high - p.low);
    expect(w[2]).toBeGreaterThan(w[0]);
  });
});

describe("detectSeriesAnomalies", () => {
  it("needs at least 6 active months", () => {
    expect(detectSeriesAnomalies("revenue", series([100, 100, 100, 100, 900]))).toEqual([]);
  });
  it("flags a spike and a collapse but not ordinary noise", () => {
    const out = detectSeriesAnomalies("revenue", series([100, 102, 98, 101, 99, 500, 100, 103, 20]));
    expect(out.map((a) => [a.month, a.direction])).toEqual([["2026-06", "high"], ["2026-09", "low"]]);
    expect(out[0].expected).toBe(median([100, 102, 98, 101, 99, 500, 100, 103, 20]));
  });
  it("handles an all-identical series with a single outlier (MAD = 0)", () => {
    const out = detectSeriesAnomalies("expense", series([50, 50, 50, 50, 50, 50, 400]));
    expect(out).toHaveLength(1);
    expect(out[0].month).toBe("2026-07");
  });
  it("does not report tiny deviations relative to the median", () => {
    expect(detectSeriesAnomalies("cash", series([1000, 1001, 1000, 1000, 1000, 1000, 1002]))).toEqual([]);
  });
});

describe("findDuplicateEntries", () => {
  const e = (id: string, companyId: string, total: number, memo = "إيجار") =>
    ({ id, entryNumber: `J${id}`, companyId, date: new Date("2026-10-05T10:00:00Z"), memo, total });
  it("groups per company, date, total and memo — never across companies", () => {
    const out = findDuplicateEntries([e("1", "A", 500), e("2", "A", 500), e("3", "B", 500), e("4", "A", 700), e("5", "A", 500, "غير ذلك")]);
    expect(out).toHaveLength(1);
    expect(out[0].entryIds).toEqual(["1", "2"]);
  });
  it("ignores zero-value entries and sorts by amount", () => {
    const out = findDuplicateEntries([e("1", "A", 0), e("2", "A", 0), e("3", "A", 10), e("4", "A", 10), e("5", "A", 90), e("6", "A", 90)]);
    expect(out.map((d) => d.total)).toEqual([90, 10]);
  });
});

describe("trimLeadingZeros", () => {
  it("returns empty when all zeros", () => expect(trimLeadingZeros(series([0, 0]))).toEqual([]));
});
