import { describe, expect, it } from "vitest";
import { followingOccurrence, nextOccurrence, occurrence, todayKsa } from "./recurrence";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe("recurring journal schedule", () => {
  it("monthly on the last day follows month lengths, incl. leap February", () => {
    const start = d("2027-12-15");
    expect([0, 1, 2, 3].map((k) => iso(occurrence(start, "monthly", 31, k)))).toEqual(["2027-12-31", "2028-01-31", "2028-02-29", "2028-03-31"]);
  });
  it("first occurrence is never before the start date", () => {
    const sched = { startDate: d("2026-01-20"), frequency: "monthly" as const, dayOfMonth: 10 };
    expect(iso(nextOccurrence(sched, d("2026-01-01")))).toBe("2026-02-10");
    expect(iso(nextOccurrence({ ...sched, dayOfMonth: 25 }, d("2026-01-01")))).toBe("2026-01-25");
  });
  it("quarterly / semiannual / yearly steps from the start month", () => {
    const base = { startDate: d("2026-01-01"), dayOfMonth: 31 };
    expect(iso(followingOccurrence({ ...base, frequency: "quarterly" }, d("2026-01-31")))).toBe("2026-04-30");
    expect(iso(followingOccurrence({ ...base, frequency: "semiannual" }, d("2026-01-31")))).toBe("2026-07-31");
    expect(iso(followingOccurrence({ ...base, frequency: "yearly" }, d("2026-01-31")))).toBe("2027-01-31");
  });
  it("stops after the end date", () => {
    const sched = { startDate: d("2026-01-01"), endDate: d("2026-03-15"), frequency: "monthly" as const, dayOfMonth: 1 };
    expect(iso(followingOccurrence(sched, d("2026-03-01")))).toBeNull();
    expect(iso(followingOccurrence(sched, d("2026-02-01")))).toBe("2026-03-01");
  });
  it("today in KSA rolls over at 21:00 UTC", () => {
    expect(iso(todayKsa(new Date("2026-03-31T20:59:00Z")))).toBe("2026-03-31");
    expect(iso(todayKsa(new Date("2026-03-31T21:00:00Z")))).toBe("2026-04-01");
  });
});
