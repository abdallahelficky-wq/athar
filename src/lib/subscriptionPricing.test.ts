import { describe, expect, it } from "vitest";
import { fromHalalas, toHalalas, vatOnNetHalalas } from "./money";
import { riyadhDayStartUtc } from "./riyadhDate";
import { discountPct, lockedNet, type PlanPriceTable, quoteCompany, SUBSCRIPTION_VAT_PERCENT, upgradeProrationNet } from "./subscriptionPricing";

/**
 * كل مثال محسوب في docs/design/subscription-plans.md §4 و§4.1. الأسعار هنا هي الأسعار المعتمدة نفسها؛ اختبار التكامل
 * (subscriptionPreview.integration.test.ts) يقرؤها من plan_prices كما زرعها الترحيل.
 */
const PRICES: PlanPriceTable = {
  plan_basic: 500,
  plan_professional: 1000,
  plan_enterprise: 1500,
  addon_user: 120,
  addon_pos_extra_user: 600,
  addon_stations: null,
  addon_stables: null,
};
const total = (quotes: { net: number; vat: number; total: number }[]) => {
  const sum = (k: "net" | "vat" | "total") => Math.round(quotes.reduce((s, q) => s + q[k] * 100, 0)) / 100;
  return { net: sum("net"), vat: sum("vat"), total: sum("total") };
};

describe("subscription pricing formulas", () => {
  it("discounts by rank: full price first, then 20, 30, 40, capped at 50 from the 5th company (D3, D16)", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(discountPct)).toEqual([0, 20, 30, 40, 50, 50, 50]);
    expect(() => discountPct(0)).toThrow();
  });

  it("1 company, basic, yearly: 500.00 + 75.00 = 575.00", () => {
    expect(quoteCompany(PRICES, "basic", "yearly", 1)).toMatchObject({ net: 500, vat: 75, total: 575 });
  });

  it("2 companies, both basic, yearly: 900.00 + 135.00 = 1,035.00", () => {
    const q = [1, 2].map((r) => quoteCompany(PRICES, "basic", "yearly", r));
    expect(q.map((x) => x.net)).toEqual([500, 400]);
    expect(total(q)).toEqual({ net: 900, vat: 135, total: 1035 });
  });

  it("4 companies, mixed plans: 2,750.00 + 412.50 = 3,162.50", () => {
    const q = (["professional", "basic", "enterprise", "basic"] as const).map((p, i) => quoteCompany(PRICES, p, "yearly", i + 1));
    expect(q.map((x) => [x.net, x.vat])).toEqual([[1000, 150], [400, 60], [1050, 157.5], [300, 45]]);
    expect(total(q)).toEqual({ net: 2750, vat: 412.5, total: 3162.5 });
  });

  it("6 companies, all basic: 2,050.00 + 307.50 = 2,357.50 (cap on the 5th and 6th)", () => {
    const q = [1, 2, 3, 4, 5, 6].map((r) => quoteCompany(PRICES, "basic", "yearly", r));
    expect(q.map((x) => x.net)).toEqual([500, 400, 350, 300, 250, 250]);
    expect(q.map((x) => x.vat)).toEqual([75, 60, 52.5, 45, 37.5, 37.5]);
    expect(total(q)).toEqual({ net: 2050, vat: 307.5, total: 2357.5 });
  });

  it("monthly vs yearly: yearly ÷ 12 × 1.10, one rounding per line", () => {
    const one = quoteCompany(PRICES, "basic", "monthly", 1);
    expect(one).toMatchObject({ net: 45.83, vat: 6.87, total: 52.7 });
    expect(Math.round(one.total * 12 * 100) / 100).toBe(632.4);

    const two = [1, 2].map((r) => quoteCompany(PRICES, "basic", "monthly", r));
    expect(two.map((x) => [x.net, x.vat])).toEqual([[45.83, 6.87], [36.67, 5.5]]);
    expect(total(two)).toEqual({ net: 82.5, vat: 12.37, total: 94.87 });
    expect(Math.round(total(two).total * 12 * 100) / 100).toBe(1138.44);

    const ent = quoteCompany(PRICES, "enterprise", "monthly", 1);
    expect(ent).toMatchObject({ net: 137.5, vat: 20.63, total: 158.13 });
    expect(Math.round(ent.total * 12 * 100) / 100).toBe(1897.56);
    expect(quoteCompany(PRICES, "enterprise", "yearly", 1).total).toBe(1725);
  });

  it("add-ons on a basic company: 3 extra users + POS with 1 additional user = 960.00 + 144.00, undiscounted (D17, D18, D27)", () => {
    const base = quoteCompany(PRICES, "basic", "yearly", 1);
    const withAddOns = quoteCompany(PRICES, "basic", "yearly", 1, { extraUsers: 3, posEnabled: true, additionalPosUsers: 1 });
    const addOnLines = withAddOns.lines.filter((l) => l.kind !== "plan");
    expect(addOnLines.map((l) => [l.kind, l.quantity, l.net, l.vat, l.free])).toEqual([
      ["extra_users", 3, 360, 54, false],
      ["pos_included", 1, 0, 0, true],
      ["pos_extra_users", 1, 600, 90, false],
    ]);
    expect(Math.round((withAddOns.net - base.net) * 100) / 100).toBe(960);
    expect(Math.round((withAddOns.vat - base.vat) * 100) / 100).toBe(144);

    // بلا خصم حتى على شركة بالترتيب 4 (40%)
    const rank4 = quoteCompany(PRICES, "basic", "yearly", 4, { extraUsers: 3, posEnabled: true, additionalPosUsers: 1 });
    expect(rank4.lines.filter((l) => l.kind !== "plan").map((l) => l.net)).toEqual([360, 0, 600]);
    expect(rank4.lines.find((l) => l.kind === "plan")!.net).toBe(300);
  });

  it("an additional POS user is 55.00 a month; one POS user alone costs nothing (D27)", () => {
    const monthly = quoteCompany(PRICES, "basic", "monthly", 1, { posEnabled: true, additionalPosUsers: 1 });
    expect(monthly.lines.find((l) => l.kind === "pos_extra_users")).toMatchObject({ net: 55, vat: 8.25 });
    const single = quoteCompany(PRICES, "basic", "yearly", 1, { posEnabled: true });
    expect(single.total).toBe(575);
    expect(() => quoteCompany(PRICES, "basic", "yearly", 1, { additionalPosUsers: 1 })).toThrow(/تفعيل نقطة البيع/);
  });

  it("shows unpriced stations and stables as free lines (D30)", () => {
    const q = quoteCompany(PRICES, "basic", "yearly", 1, { stations: true, stables: true });
    expect(q.lines.filter((l) => l.kind === "stations" || l.kind === "stables").map((l) => [l.kind, l.net, l.free])).toEqual([["stations", 0, true], ["stables", 0, true]]);
    expect(q.total).toBe(575);
  });

  it("prorates a yearly upgrade: rank 2 basic 400 → professional 800, 184 of 365 days = 201.64 + 30.25 = 231.89 (§4.1)", () => {
    const newNet = quoteCompany(PRICES, "professional", "yearly", 2).net;
    expect(newNet).toBe(800);
    const r = upgradeProrationNet({
      newPeriodNet: newNet,
      lockedNet: 400,
      periodStart: riyadhDayStartUtc("2027-01-01"),
      periodEnd: riyadhDayStartUtc("2028-01-01"),
      changeAt: riyadhDayStartUtc("2027-07-01"),
    });
    expect(r).toEqual({ net: 201.64, remainingDays: 184, termDays: 365 });
    // ضريبة سطر الترقية بنفس قاعدة كل سطر في أثر
    const vat = fromHalalas(vatOnNetHalalas(toHalalas(r.net), SUBSCRIPTION_VAT_PERCENT));
    expect([vat, fromHalalas(toHalalas(r.net) + toHalalas(vat))]).toEqual([30.25, 231.89]);
  });

  it("prorates a monthly upgrade: basic 45.83 → professional 91.67, 21 of 31 days = 31.05 + 4.66 = 35.71 (§4.1)", () => {
    const newNet = quoteCompany(PRICES, "professional", "monthly", 1).net;
    expect(newNet).toBe(91.67);
    const r = upgradeProrationNet({
      newPeriodNet: newNet,
      lockedNet: 45.83,
      periodStart: riyadhDayStartUtc("2027-07-01"),
      periodEnd: riyadhDayStartUtc("2027-08-01"),
      // آخر اليوم السعودي 11 يوليو (23:30 بتوقيت الرياض) — يبقى اليوم نفسه، لا اليوم التالي بتوقيت UTC
      changeAt: new Date(riyadhDayStartUtc("2027-07-11").getTime() + 23.5 * 3_600_000),
    });
    expect(r).toEqual({ net: 31.05, remainingDays: 21, termDays: 31 });
    const vat = fromHalalas(vatOnNetHalalas(toHalalas(r.net), SUBSCRIPTION_VAT_PERCENT));
    expect([vat, fromHalalas(toHalalas(r.net) + toHalalas(vat))]).toEqual([4.66, 35.71]);
  });

  it("refuses to prorate a downgrade or a change outside the current term (downgrades wait for renewal, D22)", () => {
    const term = { periodStart: riyadhDayStartUtc("2027-01-01"), periodEnd: riyadhDayStartUtc("2028-01-01") };
    expect(() => upgradeProrationNet({ ...term, newPeriodNet: 400, lockedNet: 1200, changeAt: riyadhDayStartUtc("2027-07-01") })).toThrow(/التجديد/);
    expect(() => upgradeProrationNet({ ...term, newPeriodNet: 800, lockedNet: 400, changeAt: riyadhDayStartUtc("2028-01-01") })).toThrow(/خارج/);
  });

  it("uses the grandfathered price as the locked price when set (D10)", () => {
    expect(lockedNet({ netPrice: 400, grandfatheredNetPrice: 250 })).toBe(250);
    expect(lockedNet({ netPrice: 400, grandfatheredNetPrice: null })).toBe(400);
  });
});
