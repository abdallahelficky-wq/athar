import { describe, expect, it } from "vitest";
import { addMonths, amortizationPlan, amortizedThrough, generateInstallments, monthEndDay, splitLeaseVat } from "./leaseSchedule";

const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((s, r) => s + r.amount * 100, 0)) / 100;

describe("splitLeaseVat", () => {
  it("extracts 15% VAT from an inclusive amount", () => {
    expect(splitLeaseVat(402500, "inclusive", 15)).toEqual({ amount: 402500, vatAmount: 52500, netAmount: 350000 });
    expect(splitLeaseVat(57500, "inclusive", 15)).toEqual({ amount: 57500, vatAmount: 7500, netAmount: 50000 });
  });

  it("keeps net + vat equal to the gross when the split does not land on a halala", () => {
    const s = splitLeaseVat(84000, "inclusive", 15);
    expect(s.vatAmount).toBe(10956.52);
    expect(Math.round((s.netAmount + s.vatAmount) * 100)).toBe(8400000);
  });

  it("charges no VAT on a contract without VAT", () => {
    expect(splitLeaseVat(36666, "none", 15)).toEqual({ amount: 36666, vatAmount: 0, netAmount: 36666 });
  });
});

describe("generateInstallments", () => {
  it("builds a bi-monthly schedule whose periods tile the contract without gaps", () => {
    const rows = generateInstallments("2026-12-01", 2, "2027-12-31");
    expect(rows.map((r) => r.dueDate)).toEqual(["2026-12-01", "2027-02-01", "2027-04-01", "2027-06-01", "2027-08-01", "2027-10-01", "2027-12-01"]);
    expect(rows[0]).toEqual({ dueDate: "2026-12-01", periodFrom: "2026-12-01", periodTo: "2027-01-31" });
    expect(rows[1].periodTo).toBe("2027-03-31");
  });

  it("does not drift after a short month when the first due date is the 31st", () => {
    const rows = generateInstallments("2027-01-31", 1, "2027-04-30");
    expect(rows.map((r) => r.dueDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(rows[1].periodTo).toBe("2027-03-30");
  });

  it("rejects an interval that is not a whole number of months", () => {
    expect(() => generateInstallments("2027-01-01", 0, "2027-12-31")).toThrow();
    expect(() => generateInstallments("2027-01-01", 1.5, "2027-12-31")).toThrow();
  });
});

describe("amortizationPlan", () => {
  it("spreads a whole-months period equally", () => {
    const plan = amortizationPlan(350000, "2027-01-01", "2027-06-30");
    expect(plan.map((p) => p.month)).toEqual(["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
    // 350,000 ÷ 6 لا تقبل القسمة على الهللة: الهللتان الباقيتان تتوزعان على الأشهر بالتقريب التراكمي، لا تتكدسان في آخر شهر
    expect(plan.map((p) => p.amount)).toEqual([58333.33, 58333.33, 58333.34, 58333.33, 58333.33, 58333.34]);
    expect(sum(plan)).toBe(350000);
  });

  it("weights a period that starts mid-month by covered days and still sums to the net", () => {
    const plan = amortizationPlan(3000, "2027-01-16", "2027-02-15");
    // 16 يوماً من يناير و15 من فبراير = 31 يوماً
    expect(plan).toEqual([{ month: "2027-01", amount: 1548.38 }, { month: "2027-02", amount: 1451.62 }]);
    expect(sum(plan)).toBe(3000);
  });

  it("puts a one-month payment entirely in its month", () => {
    expect(amortizationPlan(33333, "2027-03-01", "2027-03-31")).toEqual([{ month: "2027-03", amount: 33333 }]);
  });
});

describe("amortizedThrough", () => {
  it("is cumulative, so a skipped month is caught up by the next run", () => {
    expect(amortizedThrough(1200000, "2026-10-01", "2027-09-30", "2026-09")).toBe(0);
    expect(amortizedThrough(1200000, "2026-10-01", "2027-09-30", "2026-12")).toBe(300000);
    expect(amortizedThrough(1200000, "2026-10-01", "2027-09-30", "2027-09")).toBe(1200000);
    expect(amortizedThrough(1200000, "2026-10-01", "2027-09-30", "2028-01")).toBe(1200000);
  });
});

describe("date helpers", () => {
  it("adds months across a year boundary and clamps the day", () => {
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2027-12-15", 1)).toBe("2028-01-15");
  });

  it("returns the last day of a month, including a leap February", () => {
    expect(monthEndDay("2027-02")).toBe("2027-02-28");
    expect(monthEndDay("2028-02")).toBe("2028-02-29");
  });
});
