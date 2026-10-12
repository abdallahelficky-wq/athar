import { describe, expect, it } from "vitest";
import { guardedModels } from "./subscriptionWriteGuard";
import { companySubscriptionSchema } from "../modules/platformAdmin/platformAdmin.schemas";

/** حارس الكتابة (P4): الجداول التي يحرسها مأخوذة من مخطط Prisma نفسه (كل جدول بعمود companyId)، لا من قائمة يدوية */
describe("subscription write guard coverage", () => {
  it("guards every company-owned table that a request writes, and none of the subscription bookkeeping tables", () => {
    const guarded = guardedModels();
    for (const model of ["Company", "JournalEntry", "SalesInvoice", "Receipt", "Warehouse", "StockMovement", "Customer", "Employee", "FixedAsset"]) {
      expect(guarded, model).toContain(model);
    }
    for (const exempt of ["AuditLog", "CompanySubscription", "CompanyPosUser"]) expect(guarded).not.toContain(exempt);
    expect(guarded.length).toBeGreaterThan(40);
  });

  it("accepts only a real subscription term from the admin API: end after start", () => {
    const base = { plan: "basic", billingPeriod: "yearly", status: "active", enforced: true };
    expect(companySubscriptionSchema.safeParse({ ...base, currentPeriodStart: "2026-01-01", currentPeriodEnd: "2027-01-01" }).success).toBe(true);
    expect(companySubscriptionSchema.safeParse({ ...base, currentPeriodStart: "2027-01-01", currentPeriodEnd: "2026-01-01" }).success).toBe(false);
    expect(companySubscriptionSchema.safeParse({ ...base, currentPeriodStart: "2026-01-01", currentPeriodEnd: "2027-01-01", posUsers: -1 }).success).toBe(false);
  });
});
