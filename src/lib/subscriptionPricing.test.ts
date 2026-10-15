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

  it("monthly vs yearly: yearly ÷ 12 × 1.20 (D34), one rounding per line — yearly is 'pay 10 months, get 12'", () => {
    // 500 × 120 / 1200 = 50.00؛ الضريبة 7.50؛ 57.50 × 12 = 690.00 مقابل 575.00 سنوياً (+20%)
    const one = quoteCompany(PRICES, "basic", "monthly", 1);
    expect(one).toMatchObject({ net: 50, vat: 7.5, total: 57.5 });
    expect(Math.round(one.total * 12 * 100) / 100).toBe(690);
    expect(Math.round(one.net * 10 * 100) / 100).toBe(quoteCompany(PRICES, "basic", "yearly", 1).net); // 10 أشهر = سنة

    // الترتيب 2 (20%): 50 × 0.8 = 40.00، الضريبة 6.00؛ معاً 90.00 + 13.50 = 103.50، × 12 = 1,242.00 مقابل 1,035.00
    const two = [1, 2].map((r) => quoteCompany(PRICES, "basic", "monthly", r));
    expect(two.map((x) => [x.net, x.vat])).toEqual([[50, 7.5], [40, 6]]);
    expect(total(two)).toEqual({ net: 90, vat: 13.5, total: 103.5 });
    expect(Math.round(total(two).total * 12 * 100) / 100).toBe(1242);

    // 1500 × 120 / 1200 = 150.00، الضريبة 22.50؛ 172.50 × 12 = 2,070.00 مقابل 1,725.00
    const ent = quoteCompany(PRICES, "enterprise", "monthly", 1);
    expect(ent).toMatchObject({ net: 150, vat: 22.5, total: 172.5 });
    expect(Math.round(ent.total * 12 * 100) / 100).toBe(2070);
    expect(quoteCompany(PRICES, "enterprise", "yearly", 1).total).toBe(1725);
    expect(quoteCompany(PRICES, "professional", "monthly", 1).net).toBe(100);
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

  it("an additional POS user is 60.00 a month and an extra user 12.00; one POS user alone costs nothing (D27, D34)", () => {
    // 600 × 120 / 1200 = 60.00، الضريبة 9.00؛ 120 × 120 / 1200 = 12.00، الضريبة 1.80
    const monthly = quoteCompany(PRICES, "basic", "monthly", 1, { posEnabled: true, additionalPosUsers: 1, extraUsers: 1 });
    expect(monthly.lines.find((l) => l.kind === "pos_extra_users")).toMatchObject({ net: 60, vat: 9 });
    expect(monthly.lines.find((l) => l.kind === "extra_users")).toMatchObject({ net: 12, vat: 1.8 });
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

  it("prorates a monthly upgrade: basic 50.00 → professional 100.00, 21 of 31 days = 33.87 + 5.08 = 38.95 (§4.1)", () => {
    // الفرق 50.00 × 21 / 31 = 33.870967… → 33.87؛ الضريبة 33.87 × 0.15 = 5.0805 → 5.08؛ المستحق 38.95
    const newNet = quoteCompany(PRICES, "professional", "monthly", 1).net;
    expect(newNet).toBe(100);
    const r = upgradeProrationNet({
      newPeriodNet: newNet,
      lockedNet: quoteCompany(PRICES, "basic", "monthly", 1).net,
      periodStart: riyadhDayStartUtc("2027-07-01"),
      periodEnd: riyadhDayStartUtc("2027-08-01"),
      // آخر اليوم السعودي 11 يوليو (23:30 بتوقيت الرياض) — يبقى اليوم نفسه، لا اليوم التالي بتوقيت UTC
      changeAt: new Date(riyadhDayStartUtc("2027-07-11").getTime() + 23.5 * 3_600_000),
    });
    expect(r).toEqual({ net: 33.87, remainingDays: 21, termDays: 31 });
    const vat = fromHalalas(vatOnNetHalalas(toHalalas(r.net), SUBSCRIPTION_VAT_PERCENT));
    expect([vat, fromHalalas(toHalalas(r.net) + toHalalas(vat))]).toEqual([5.08, 38.95]);
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
