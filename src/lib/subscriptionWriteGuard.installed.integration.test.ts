import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { createApp } from "../app";
import { register } from "../modules/auth/auth.service";
import { isSubscriptionWriteGuardInstalled } from "./subscriptionWriteGuard";
import { runWithRequestContext } from "./requestContext";
import { clearSubscriptionEnforcementCache } from "./subscriptionEnforcement";
import { setEnforcementSwitch, upsertCompanySubscription } from "../modules/subscriptions/subscriptionAdmin.service";

/**
 * حارس الكتابة للاشتراكات (P4) مركَّب فعلاً ويعمل على عميل Prisma نفسه الذي يستخدمه كل الكود. اليوم عبر $use (مهمل في Prisma 5،
 * محذوف في 6) — قبل أي ترقية إلى Prisma 6 يُنقَل إلى $extends (docs/design/subscription-plans.md §5.1)، وهذا الاختبار يفشل إن لم
 * يُركَّب الحارس الجديد أو لم يعد يرفض الكتابة.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let tenantId = "";
let companyId = "";

describe("subscription write guard is installed on the shared Prisma client", () => {
  beforeAll(async () => {
    createApp();
    const r = await register({ tenantName: `حارس مركَّب ${stamp}`, businessActivity: "retail", name: "المالك", email: `guard-inst-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const end = new Date(Date.now() - 30 * 86_400_000);
    await upsertCompanySubscription(companyId, { plan: "basic", billingPeriod: "yearly", status: "active", currentPeriodStart: new Date(end.getTime() - 365 * 86_400_000), currentPeriodEnd: end, enforced: true });
    await setEnforcementSwitch(true);
    clearSubscriptionEnforcementCache();
  }, 120_000);

  afterAll(async () => {
    await setEnforcementSwitch(false);
  });

  it("createApp installs the guard", () => {
    expect(isSubscriptionWriteGuardInstalled()).toBe(true);
  });

  it("refuses a write into an enforced read-only company made through the shared client during a user request, and allows it outside one", async () => {
    const write = () => prisma.customer.create({ data: { tenantId, companyId, name: `عميل الحارس ${Math.random()}` } });
    // استعلامات Prisma كسولة (تُنفَّذ عند await)، فيُنتظَر الاستعلام داخل السياق كما في أي معالج طلب
    await expect(runWithRequestContext({ tenantId, userId: "u", method: "POST", writeResources: new Set(["customers"]) }, async () => await write())).rejects.toMatchObject({ status: 403 });
    // بلا سياق طلب مستخدم (مهمة خلفية) لا يتدخّل الحارس
    await expect(write()).resolves.toMatchObject({ companyId });
  });
});
