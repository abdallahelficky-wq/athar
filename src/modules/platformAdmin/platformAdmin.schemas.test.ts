import { describe, expect, it } from "vitest";
import { companySubscriptionSchema, isRealCalendarDay, schedulePlanPriceSchema, updateSubscriptionSchema } from "./platformAdmin.schemas";

/**
 * مراجعة #164 (4): تواريخ لوحة مدير المنصة أيام تقويمية حقيقية. JavaScript يطبّع 2027-02-30 إلى 2 مارس بلا خطأ، فبلا هذا الفحص يُخزَّن
 * سعرٌ أو نهاية اشتراك في يوم غير الذي أرسله المدير، وشهر 13 يصل خطأً داخلياً من Prisma.
 */
const IMPOSSIBLE = ["2027-02-30", "2027-02-29", "2027-04-31", "2027-13-01", "2027-00-10", "2027-06-00", "2027-02-30T00:00:00.000Z"];
const REAL = ["2028-02-29", "2027-12-31", "2027-01-01", "2027-03-15T10:30:00.000Z"];

describe("platform-admin schemas reject impossible calendar dates", () => {
  it("knows which days exist", () => {
    for (const d of IMPOSSIBLE) expect(isRealCalendarDay(d), d).toBe(false);
    for (const d of REAL) expect(isRealCalendarDay(d), d).toBe(true);
  });

  it("effectiveFrom of a scheduled price", () => {
    const price = (effectiveFrom: string) => schedulePlanPriceSchema.safeParse({ item: "plan_basic", yearlyNetPrice: 100, effectiveFrom });
    for (const d of IMPOSSIBLE.filter((v) => v.length === 10)) expect(price(d).success, d).toBe(false);
    expect(price("2028-02-29").success).toBe(true);
    expect(price("2027-12-31").success).toBe(true);
    expect(price("2027-12-31T00:00:00Z").success).toBe(false); // يوم فقط، كما كان
  });

  it("the start and end of a company subscription term", () => {
    const term = (start: string, end: string) =>
      companySubscriptionSchema.safeParse({ plan: "basic", billingPeriod: "yearly", status: "active", enforced: true, currentPeriodStart: start, currentPeriodEnd: end, expectedVersion: null });
    expect(term("2026-03-01", "2027-02-30").success).toBe(false);
    expect(term("2026-13-01", "2027-03-01").success).toBe(false);
    expect(term("2026-02-30T00:00:00.000Z", "2027-03-01").success).toBe(false);
    const ok = term("2026-03-01", "2027-02-28");
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.currentPeriodEnd.toISOString()).toBe("2027-02-28T00:00:00.000Z");
    expect(term("2026-03-01T00:00:00.000Z", "2028-02-29T00:00:00.000Z").success).toBe(true);
  });

  it("a tenant's trial end, which stays optional and nullable", () => {
    expect(updateSubscriptionSchema.safeParse({ trialEndsAt: "2027-02-30" }).success).toBe(false);
    expect(updateSubscriptionSchema.safeParse({ trialEndsAt: "2027-02-28" }).success).toBe(true);
    const cleared = updateSubscriptionSchema.safeParse({ trialEndsAt: null });
    expect(cleared.success && cleared.data.trialEndsAt).toBeNull();
    expect(updateSubscriptionSchema.safeParse({}).success).toBe(true);
  });
});
