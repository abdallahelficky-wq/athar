import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { authenticatePlatformService } from "../../middleware/auth";
import { createIndependentTenant, register } from "../auth/auth.service";
import { platformAdminRoutes } from "../platformAdmin/platformAdmin.routes";
import {
  companySubscriptionAddonsSchema,
  companySubscriptionStatusSchema,
  schedulePlanPriceSchema,
} from "../platformAdmin/platformAdmin.schemas";
import {
  deleteScheduledPlanPrice,
  getCompanySubscriptionDetail,
  listCompanySubscriptions,
  listPlanPrices,
  schedulePlanPrice,
  setCompanyPosUsers,
  setCompanySubscriptionStatus,
  updateCompanySubscriptionAddons,
  upsertCompanySubscription,
} from "./subscriptionAdmin.service";

/**
 * واجهة لوحة مدير المنصة للاشتراكات (P8، docs/design/subscription-plans.md §9). المسارات خلف مفتاح خدمة المنصة (لا يُضبط هنا: لا
 * متغيرات بيئة في الاختبار)، فتُختبَر الخدمات نفسها التي تستدعيها المسارات مباشرة، ومخططات الطلب، وتسجيل المسارات خلف المفتاح.
 * المستأجرون والشركات من مسارات التسجيل الحقيقية؛ صفوف الاشتراك من خدمة الإدارة نفسها.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const DAY = 86_400_000;
let tenantA = "";
let ownerA = "";
let companyA1 = "";
let companyA2 = "";
let companyInd = "";
let tenantB = "";
let companyB = "";

const term = (endDays: number) => {
  const end = new Date(Date.now() + endDays * DAY);
  return { currentPeriodStart: new Date(end.getTime() - 365 * DAY), currentPeriodEnd: end };
};

describe("platform-admin subscriptions API (P8)", () => {
  beforeAll(async () => {
    const a = await register({ tenantName: `لوحة الإدارة ${stamp}`, businessActivity: "retail", name: "المالك أ", email: `p8-a-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantA = a.tenant.id;
    ownerA = a.user.id;
    companyA1 = (await prisma.company.findFirstOrThrow({ where: { tenantId: tenantA } })).id;
    companyA2 = (await prisma.company.create({ data: { tenantId: tenantA, name: `فرع ${stamp}`, createdAt: new Date(Date.now() + 1000) } })).id;
    companyInd = (await createIndependentTenant(ownerA, { name: `مستقلة ${stamp}`, businessActivity: "retail" })).company.id;
    await prisma.company.update({ where: { id: companyInd }, data: { createdAt: new Date(Date.now() + 2000) } });
    // عضوان إضافيان نطاقهما A1 — مع المالك (all) = 3 مقاعد مشغولة في A1
    for (const tag of ["m1", "m2"]) {
      const identity = await prisma.identity.create({ data: { email: `p8-${tag}-${stamp}@example.com` } });
      await prisma.user.create({ data: { tenantId: tenantA, identityId: identity.id, name: tag, role: "accountant", inviteStatus: "accepted", companyScope: companyA1 } });
    }
    const b = await register({ tenantName: `لوحة الإدارة ${stamp}`, businessActivity: "retail", name: "المالك ب", email: `p8-b-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantB = b.tenant.id;
    companyB = (await prisma.company.findFirstOrThrow({ where: { tenantId: tenantB } })).id;

    await upsertCompanySubscription(companyA1, { plan: "basic", billingPeriod: "yearly", status: "active", ...term(30), enforced: false });
  }, 120_000);

  it("lists companies with their subscription, seats against the limit, POS capacity, live rank and the legacy tenant state", async () => {
    const rows = await listCompanySubscriptions({ tenantId: tenantA });
    const byId = new Map(rows.map((r) => [r.companyId, r]));
    expect(rows.map((r) => r.companyId).sort()).toEqual([companyA1, companyA2].sort()); // التصفية بالمستأجر لا تُظهر المستقلة ولا مستأجر ب
    const a1 = byId.get(companyA1)!;
    expect(a1.subscription).toMatchObject({ plan: "basic", status: "active", enforced: false, readOnlyNow: false });
    expect(a1.users).toEqual({ occupied: 3, limit: 2, overLimit: true }); // تجاوز الحد يُعلَّم ولا يُخرج أحداً
    expect(a1.pos).toEqual({ assigned: 0, capacity: 0 });
    expect(a1.tenant).toMatchObject({ legacyStatus: "trialing", legacyPlan: "basic" });
    expect(a1.ownerEmail).toBe(`p8-a-${stamp}@example.com`);
    expect(byId.get(companyA2)!.subscription).toBeNull(); // بلا صف = سلوك اليوم
    // الترتيب الحي عبر مستأجرَي المالك نفسه: A1 ثم الفرع ثم المستقلة
    const all = await listCompanySubscriptions({ q: `${stamp}` });
    expect([companyA1, companyA2, companyInd].map((id) => all.find((r) => r.companyId === id)!.liveRank)).toEqual([1, 2, 3]);
    expect(all.find((r) => r.companyId === companyB)!.liveRank).toBe(1);
    // تصفية بالحالة
    expect((await listCompanySubscriptions({ tenantId: tenantA, status: "none" })).map((r) => r.companyId)).toEqual([companyA2]);
    expect((await listCompanySubscriptions({ tenantId: tenantA, status: "active" })).map((r) => r.companyId)).toEqual([companyA1]);
  });

  it("returns a company's detail: modules of its plan, members eligible for POS, and the event history", async () => {
    const d = await getCompanySubscriptionDetail(companyA1);
    expect(d.modules).toContain("salesInvoices");
    expect(d.modules).not.toContain("warehouses"); // الأساسية
    expect(d.members.map((m) => m.email).sort()).toEqual([`p8-a-${stamp}@example.com`, `p8-m1-${stamp}@example.com`, `p8-m2-${stamp}@example.com`].sort());
    expect(d.events.map((e) => e.type)).toContain("created");
    expect((await getCompanySubscriptionDetail(companyA2)).subscription).toBeNull();
    await expect(getCompanySubscriptionDetail("missing-company")).rejects.toThrow("الشركة غير موجودة");
  });

  it("suspends with a reason and reactivates to the by-date status, with events; refuses activating what isn't suspended", async () => {
    expect(companySubscriptionStatusSchema.safeParse({ action: "suspend" }).success).toBe(false);
    expect(companySubscriptionStatusSchema.safeParse({ action: "suspend", reason: "مراجعة" }).success).toBe(true);
    const suspended = await setCompanySubscriptionStatus(companyA1, "suspend", "مراجعة إدارية");
    expect([suspended.status, suspended.suspensionReason]).toEqual(["suspended", "مراجعة إدارية"]);
    expect((await listCompanySubscriptions({ tenantId: tenantA, status: "suspended" }))[0].subscription!.readOnlyNow).toBe(true);
    const activated = await setCompanySubscriptionStatus(companyA1, "activate");
    expect(activated.status).toBe("active");
    await expect(setCompanySubscriptionStatus(companyA1, "activate")).rejects.toThrow("الاشتراك ليس معلّقاً");
    // حدثان قد يقعان في الجزء نفسه من الثانية، فلا يُعتمَد ترتيبهما — وجودهما والحالة النهائية هما المعيار
    const types = (await getCompanySubscriptionDetail(companyA1)).events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["activated", "suspended"]));
    expect((await getCompanySubscriptionDetail(companyA1)).subscription!.status).toBe("active");
  });

  it("updates add-ons with an event, never below the POS users already assigned, never paid POS seats without POS", async () => {
    expect(companySubscriptionAddonsSchema.safeParse({}).success).toBe(false);
    await expect(updateCompanySubscriptionAddons(companyA1, { posUsers: 1 })).rejects.toThrow("نقطة البيع غير مفعّلة");
    const on = await updateCompanySubscriptionAddons(companyA1, { posEnabled: true, posUsers: 1, extraUsers: 1 });
    expect([on.posEnabled, on.posUsers, on.extraUsers]).toEqual([true, 1, 1]);
    const members = (await getCompanySubscriptionDetail(companyA1)).members.map((m) => m.id);
    await setCompanyPosUsers(companyA1, members.slice(0, 2)); // سعة 1 + 1
    await expect(updateCompanySubscriptionAddons(companyA1, { posUsers: 0 })).rejects.toThrow("أكبر من السعة الجديدة");
    await expect(updateCompanySubscriptionAddons(companyA1, { posEnabled: false })).rejects.toThrow("أكبر من السعة الجديدة");
    await setCompanyPosUsers(companyA1, []);
    const off = await updateCompanySubscriptionAddons(companyA1, { posEnabled: false });
    expect([off.posEnabled, off.posUsers]).toEqual([false, 0]); // إيقاف نقطة البيع يصفّر مقاعدها الإضافية
    const event = (await getCompanySubscriptionDetail(companyA1)).events.find((e) => e.type === "addons_changed")!;
    expect(event).toMatchObject({ actor: "platform_admin", before: { posEnabled: true, posUsers: 1 }, after: { posEnabled: false, posUsers: 0 } });
    // المستخدمون الإضافيون يرفعون الحد ويُزيلون علَم التجاوز
    const a1 = (await listCompanySubscriptions({ tenantId: tenantA })).find((r) => r.companyId === companyA1)!;
    expect(a1.users).toEqual({ occupied: 3, limit: 3, overLimit: false });
    await expect(updateCompanySubscriptionAddons(companyA2, { extraUsers: 1 })).rejects.toThrow("لا يوجد اشتراك لهذه الشركة");
  });

  it("lists the price catalog, schedules a future price, refuses today or a duplicate, and deletes only what isn't in effect", async () => {
    const catalog = await listPlanPrices();
    expect(catalog.current.plan_basic).toBe(500);
    const seed = catalog.rows.find((r) => r.id === "plan_price_seed_basic")!;
    expect(seed).toMatchObject({ yearlyNetPrice: 500, scheduled: false });

    expect(schedulePlanPriceSchema.safeParse({ item: "plan_basic", yearlyNetPrice: -1, effectiveFrom: "2999-01-01" }).success).toBe(false);
    expect(schedulePlanPriceSchema.safeParse({ item: "plan_basic", yearlyNetPrice: 550, effectiveFrom: "1/1/2999" }).success).toBe(false);
    await expect(schedulePlanPrice({ item: "plan_basic", yearlyNetPrice: 550, effectiveFrom: riyadhCalendarDay(new Date()) })).rejects.toThrow("بعد اليوم");

    const future = `${3500 + (stamp % 400)}-01-01`;
    const created = await schedulePlanPrice({ item: "addon_stations", yearlyNetPrice: 250, effectiveFrom: future });
    await expect(schedulePlanPrice({ item: "addon_stations", yearlyNetPrice: 300, effectiveFrom: future })).rejects.toThrow("في التاريخ نفسه");
    expect((await listPlanPrices()).rows.find((r) => r.id === created.id)).toMatchObject({ item: "addon_stations", yearlyNetPrice: 250, effectiveFrom: future, scheduled: true });
    expect((await listPlanPrices()).current.addon_stations).toBeNull(); // لم يسرِ بعد: المحطات مجانية اليوم (D30)
    await expect(deleteScheduledPlanPrice("plan_price_seed_basic")).rejects.toThrow("لا يمكن حذف سعر سارٍ");
    expect(await deleteScheduledPlanPrice(created.id)).toEqual({ deleted: created.id });
  });

  it("registers every route behind the platform service key", () => {
    const stack = (platformAdminRoutes as unknown as { stack: { handle: unknown; route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    expect(stack[0].handle).toBe(authenticatePlatformService); // router.use أولاً: كل ما بعده خلف المفتاح
    const routes = stack.filter((l) => l.route).map((l) => `${Object.keys(l.route!.methods)[0].toUpperCase()} ${l.route!.path}`);
    for (const r of [
      "GET /subscription-enforcement",
      "PUT /subscription-enforcement",
      "GET /companies",
      "GET /companies/:companyId/subscription",
      "PUT /companies/:companyId/subscription",
      "PATCH /companies/:companyId/subscription/status",
      "PATCH /companies/:companyId/subscription/addons",
      "PUT /companies/:companyId/pos-users",
      "GET /plan-prices",
      "POST /plan-prices",
      "DELETE /plan-prices/:id",
    ]) {
      expect(routes, r).toContain(r);
    }
  });
});
