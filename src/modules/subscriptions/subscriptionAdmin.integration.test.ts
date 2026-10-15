import { beforeAll, describe, expect, it } from "vitest";
import type { CompanySubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { authenticatePlatformService } from "../../middleware/auth";
import { createIndependentTenant, register } from "../auth/auth.service";
import { platformAdminRoutes } from "../platformAdmin/platformAdmin.routes";
import {
  companySubscriptionAddonsSchema,
  companySubscriptionSchema,
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
    const rows = (await listCompanySubscriptions({ tenantId: tenantA })).items;
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
    const all = (await listCompanySubscriptions({ q: `${stamp}` })).items;
    expect([companyA1, companyA2, companyInd].map((id) => all.find((r) => r.companyId === id)!.liveRank)).toEqual([1, 2, 3]);
    expect(all.find((r) => r.companyId === companyB)!.liveRank).toBe(1);
    // تصفية بالحالة
    expect((await listCompanySubscriptions({ tenantId: tenantA, status: "none" })).items.map((r) => r.companyId)).toEqual([companyA2]);
    expect((await listCompanySubscriptions({ tenantId: tenantA, status: "active" })).items.map((r) => r.companyId)).toEqual([companyA1]);
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
    expect((await listCompanySubscriptions({ tenantId: tenantA, status: "suspended" })).items[0].subscription!.readOnlyNow).toBe(true);
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
    expect(companySubscriptionAddonsSchema.safeParse({ expectedVersion: 0 }).success).toBe(false); // النسخة وحدها ليست تغييراً
    expect(companySubscriptionAddonsSchema.safeParse({ posUsers: 1 }).success).toBe(false); // النسخة إلزامية
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
    const a1 = (await listCompanySubscriptions({ tenantId: tenantA })).items.find((r) => r.companyId === companyA1)!;
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

  it("allows a null (no) price only for the activity add-ons — never for plans, extra users or POS seats", async () => {
    // مراجعة #164: بند مدفوع بلا سعر يكسر عرض السعر (quoteCompany) لكل من يختاره
    const future = `${3100 + (stamp % 400)}-02-01`;
    for (const item of ["plan_basic", "plan_professional", "plan_enterprise", "addon_user", "addon_pos_extra_user"] as const) {
      const parsed = schedulePlanPriceSchema.safeParse({ item, yearlyNetPrice: null, effectiveFrom: future });
      expect([item, parsed.success]).toEqual([item, false]);
      expect(parsed.error!.flatten().fieldErrors.yearlyNetPrice).toEqual(["هذا البند يحتاج سعراً — (بلا سعر) مسموح لإضافتَي المحطات والإسطبلات فقط"]);
      // والخدمة نفسها ترفض، لمستدعٍ لا يمرّ بالمخطط
      await expect(schedulePlanPrice({ item, yearlyNetPrice: null, effectiveFrom: future }), item).rejects.toThrow("هذا البند يحتاج سعراً");
      expect(await prisma.planPrice.count({ where: { item, effectiveFrom: new Date(`${future}T00:00:00.000Z`) } })).toBe(0);
    }
    for (const item of ["addon_stations", "addon_stables"] as const) {
      expect(schedulePlanPriceSchema.safeParse({ item, yearlyNetPrice: null, effectiveFrom: future }).success).toBe(true);
      const created = await schedulePlanPrice({ item, yearlyNetPrice: null, effectiveFrom: future });
      expect(created.yearlyNetPrice).toBeNull();
      await deleteScheduledPlanPrice(created.id);
    }
    // سعر صفر لبند مدفوع مسموح (قرار تسعير صريح)، وليس "بلا سعر"
    expect(schedulePlanPriceSchema.safeParse({ item: "addon_user", yearlyNetPrice: 0, effectiveFrom: future }).success).toBe(true);
  });

  // مراجعة #164 (3): PUT الاشتراك بلا حقول الإضافات لا يُطفئ نقطة البيع ولا يصفّر المقاعد المدفوعة ولا يترك تعيينات فوق السعة
  it("keeps add-ons and POS assignments on a subscription PUT that omits them; defaults apply only when creating", async () => {
    await updateCompanySubscriptionAddons(companyA1, { posEnabled: true, posUsers: 1, extraUsers: 2 });
    const members = (await getCompanySubscriptionDetail(companyA1)).members.map((m) => m.id);
    await setCompanyPosUsers(companyA1, members.slice(0, 2)); // السعة 1 مجاني + 1 مدفوع

    // طلب المدير كما يصل إلى المسار: تغيير الباقة والتواريخ والحالة فقط
    const end = new Date(Date.now() + 200 * DAY);
    const versionOf = async (companyId: string) => (await getCompanySubscriptionDetail(companyId)).subscription?.version ?? null;
    const planOnly = companySubscriptionSchema.parse({
      plan: "professional", billingPeriod: "yearly", status: "active", enforced: false,
      currentPeriodStart: new Date(end.getTime() - 365 * DAY).toISOString(), currentPeriodEnd: end.toISOString(),
      expectedVersion: await versionOf(companyA1),
    });
    const updated = await upsertCompanySubscription(companyA1, planOnly);
    expect([updated.plan, updated.posEnabled, updated.posUsers, updated.extraUsers]).toEqual(["professional", true, 1, 2]);
    expect(await prisma.companyPosUser.count({ where: { companyId: companyA1 } })).toBe(2);

    // تغيير صريح يُنقص السعة تحت المعيَّنين مرفوض، كمسار الإضافات؛ والصف لا يتغير
    await expect(upsertCompanySubscription(companyA1, { ...planOnly, expectedVersion: await versionOf(companyA1), posUsers: 0 })).rejects.toThrow("أكبر من السعة الجديدة");
    await expect(upsertCompanySubscription(companyA1, { ...planOnly, expectedVersion: await versionOf(companyA1), posEnabled: false })).rejects.toThrow("أكبر من السعة الجديدة");
    expect((await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: companyA1 } })).posUsers).toBe(1);

    // الإنشاء بلا حقول الإضافات: الافتراضي (معطّلة، صفر)
    const created = await upsertCompanySubscription(companyA2, { ...planOnly, expectedVersion: null });
    expect([created.posEnabled, created.posUsers, created.extraUsers]).toEqual([false, 0, 0]);

    // تنظيف: إعادة A1 كما تركها الاختبار السابق
    await setCompanyPosUsers(companyA1, []);
    await updateCompanySubscriptionAddons(companyA1, { posEnabled: false, extraUsers: 1 });
    await upsertCompanySubscription(companyA1, { ...planOnly, expectedVersion: await versionOf(companyA1), plan: "basic", ...term(30) });
  });

  it("assigns POS seats only to members the detail lists as eligible (active, accepted, scope all or this company, same tenant)", async () => {
    // مراجعة #164: كان التعيين يقبل أي معرّف مستخدم. الأهلية = الشرط نفسه الذي يعرض به التفصيل "الأعضاء المؤهَّلين"
    await upsertCompanySubscription(companyA1, { plan: "basic", billingPeriod: "yearly", status: "active", ...term(30), enforced: false, posEnabled: true, posUsers: 5 });
    const member = async (tag: string, data: { tenantId?: string; active?: boolean; inviteStatus?: "pending" | "accepted"; companyScope?: string; deletedAt?: Date }) => {
      const identity = await prisma.identity.create({ data: { email: `p8-pos-${tag}-${stamp}@example.com` } });
      return (await prisma.user.create({
        data: { tenantId: data.tenantId ?? tenantA, identityId: identity.id, name: tag, role: "accountant", inviteStatus: data.inviteStatus ?? "accepted", companyScope: data.companyScope ?? companyA1, active: data.active ?? true, deletedAt: data.deletedAt },
      })).id;
    };
    const ineligible = {
      otherTenant: await member("other-tenant", { tenantId: tenantB, companyScope: "all" }),
      otherCompany: await member("other-company", { companyScope: companyA2 }),
      inactive: await member("inactive", { active: false }),
      pending: await member("pending", { inviteStatus: "pending" }),
      deleted: await member("deleted", { deletedAt: new Date() }),
    };
    const eligibleIds = (await getCompanySubscriptionDetail(companyA1)).members.map((m) => m.id);
    for (const [label, id] of Object.entries(ineligible)) {
      expect(eligibleIds, label).not.toContain(id);
      await expect(setCompanyPosUsers(companyA1, [ownerA, id]), label).rejects.toThrow("لا يمكن تعيين مستخدم لنقطة البيع");
    }
    expect((await getCompanySubscriptionDetail(companyA1)).pos.assignedUserIds).toEqual([]); // المرفوض لا يكتب شيئاً
    const ok = await setCompanyPosUsers(companyA1, eligibleIds.slice(0, 2));
    expect(ok.userIds).toEqual([...eligibleIds.slice(0, 2)].sort());
    await setCompanyPosUsers(companyA1, []);
  });

  it("derives readOnlyFrom from the status: immediate when unpaid/canceled/suspended/expired, trial end, paid end + 7 days", async () => {
    // مراجعة #164: كان readOnlyFrom = النهاية + 7 لكل حالة غير التجربة، فشركة بانتظار الدفع أو ملغاة أو معلّقة (عرض فقط الآن) تُعرض
    // كأنها تكتب أسبوعاً بعد نهاية فترتها. الصف يكتبه upsertCompanySubscription والقيمة من getCompanySubscriptionDetail نفسها.
    const company = (await prisma.company.create({ data: { tenantId: tenantB, name: `حالات ${stamp}` } })).id;
    const now = new Date("2026-10-14T09:00:00.000Z");
    const end = new Date("2026-11-01T00:00:00.000Z");
    const plusGrace = new Date("2026-11-08T00:00:00.000Z");
    const expected: Record<CompanySubscriptionStatus, Date> = {
      awaiting_payment: now,
      canceled: now,
      suspended: now,
      expired: now,
      trialing: end,
      active: plusGrace,
      grace: plusGrace,
    };
    for (const [status, from] of Object.entries(expected) as [CompanySubscriptionStatus, Date][]) {
      // التعليق والتفعيل بمسارهما وحده (مراجعة #166)
      if ((await prisma.companySubscription.findUnique({ where: { companyId: company } }))?.status === "suspended") await setCompanySubscriptionStatus(company, "activate");
      await upsertCompanySubscription(company, {
        plan: "basic", billingPeriod: "yearly", status: status === "suspended" ? "active" : status,
        currentPeriodStart: new Date("2025-11-01T00:00:00.000Z"), currentPeriodEnd: end, enforced: false,
      });
      if (status === "suspended") await setCompanySubscriptionStatus(company, "suspend", "اختبار الحالة");
      const view = (await getCompanySubscriptionDetail(company, now)).subscription!;
      expect({ status, readOnlyFrom: view.readOnlyFrom }).toEqual({ status, readOnlyFrom: from });
      // الاتساق مع readOnlyNow: "فوراً" ⇔ عرض فقط الآن
      expect({ status, readOnlyNow: view.readOnlyNow }).toEqual({ status, readOnlyNow: from.getTime() <= now.getTime() });
    }
  });

  // ── P9: التزامن المتفائل — المدير يرسل نسخة الصف التي حمّلها، ونسخة قديمة تُرفض بـ409 مع الصف الحالي ──────────────────────
  it("bumps the row version on every update by any writer, and exposes it in the detail and list", async () => {
    const company = (await prisma.company.create({ data: { tenantId: tenantB, name: `نسخة ${stamp}` } })).id;
    expect((await getCompanySubscriptionDetail(company)).subscription).toBeNull();
    await upsertCompanySubscription(company, { plan: "basic", billingPeriod: "yearly", status: "active", ...term(30), enforced: false, expectedVersion: null });
    const v0 = (await getCompanySubscriptionDetail(company)).subscription!.version;
    expect(v0).toBe(0);
    await updateCompanySubscriptionAddons(company, { extraUsers: 1, expectedVersion: v0 });
    await setCompanySubscriptionStatus(company, "suspend", "نسخة");
    // كاتب لا يمرّ بالخدمة (المُجدوِل، استعلام مباشر): المشغّل يزيد النسخة أيضاً
    await prisma.companySubscription.update({ where: { companyId: company }, data: { discountRank: 2 } });
    expect((await getCompanySubscriptionDetail(company)).subscription!.version).toBe(3);
    expect((await listCompanySubscriptions({ tenantId: tenantB })).items.find((r) => r.companyId === company)!.subscription!.version).toBe(3);
  });

  it("refuses a stale full edit with 409 and the current row; two concurrent edits from the same loaded version: exactly one wins", async () => {
    const company = (await prisma.company.create({ data: { tenantId: tenantB, name: `تزامن ${stamp}` } })).id;
    const edit = (over: Partial<Parameters<typeof upsertCompanySubscription>[1]>) =>
      upsertCompanySubscription(company, { plan: "basic", billingPeriod: "yearly", status: "active", ...term(30), enforced: false, expectedVersion: null, ...over });
    const conflictOf = async (p: Promise<unknown>) => {
      const err = await p.then(() => null, (e) => e);
      expect(err, "expected a 409").not.toBeNull();
      return err as { status: number; details: { code: string; current: { version: number; plan: string } | null } };
    };

    // إنشاءان متزامنان كلاهما يتوقع "لا صف": واحد ينشئ، والآخر 409
    const creates = await Promise.allSettled([edit({ plan: "basic" }), edit({ plan: "enterprise" })]);
    expect(creates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lostCreate = (creates.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    expect([lostCreate.status, lostCreate.details.code, lostCreate.details.current.version]).toEqual([409, "subscription_version_conflict", 0]);

    // مديران حمّلا النسخة نفسها وحفظا معاً: يفوز واحد، والآخر 409 ومعه الصف كما كتبه الفائز
    const loaded = (await getCompanySubscriptionDetail(company)).subscription!.version;
    for (let round = 0; round < 5; round++) {
      const v = (await getCompanySubscriptionDetail(company)).subscription!.version;
      const results = await Promise.allSettled([edit({ plan: "professional", expectedVersion: v }), edit({ plan: "enterprise", expectedVersion: v })]);
      expect(results.filter((r) => r.status === "fulfilled"), `round ${round}`).toHaveLength(1);
      const winner = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ plan: string; version: number }>).value;
      const loser = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
      expect([loser.status, loser.details.current.plan, loser.details.current.version]).toEqual([409, winner.plan, v + 1]);
    }

    // نسخة قديمة بعد تعديل آخر (إضافات من تبويب آخر): 409 والصف لا يتغير
    const before = await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } });
    const stale = await conflictOf(edit({ plan: "basic", expectedVersion: loaded }));
    expect(stale.status).toBe(409);
    expect(stale.details.current!.version).toBe(before.version);
    expect(await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } })).toEqual(before);
    // الإضافات بالقاعدة نفسها، والتعليق كذلك حين تُرسَل النسخة
    expect((await conflictOf(updateCompanySubscriptionAddons(company, { extraUsers: 4, expectedVersion: loaded }))).details.code).toBe("subscription_version_conflict");
    expect((await conflictOf(setCompanySubscriptionStatus(company, "suspend", "قديم", loaded))).details.code).toBe("subscription_version_conflict");
    expect(await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } })).toEqual(before);
    // بالنسخة الحالية: يمر
    expect((await edit({ plan: "basic", expectedVersion: before.version })).version).toBe(before.version + 1);
  });

  it("suspend/activate check the loaded version inside the update itself: a write between the read and the update gets 409 and nothing is written", async () => {
    // مراجعة #166: كان فحص النسخة قبل المعاملة وحده، فكاتب بين القراءة والتحديث يمرّ تحته التعليق. هنا يُحقَن ذلك الكاتب حتمياً: لحظة
    // وصول تحديث الانتقال، يُثبَّت تعديل آخر على الصف من اتصال آخر (كما يفعله مدير في تبويب آخر أو المُجدوِل)، ثم يُكمَل التحديث
    const company = (await prisma.company.create({ data: { tenantId: tenantB, name: `ذرّي ${stamp}` } })).id;
    await upsertCompanySubscription(company, { plan: "basic", billingPeriod: "yearly", status: "active", ...term(30), enforced: false, expectedVersion: null });
    let interleave: null | ((target: string) => boolean) = null;
    prisma.$use(async (params, next) => {
      const data = (params.args as { data?: { status?: string } } | undefined)?.data;
      if (interleave && params.model === "CompanySubscription" && params.action === "updateMany" && data?.status && interleave(data.status)) {
        interleave = null;
        await prisma.$executeRaw`UPDATE "company_subscriptions" SET "extraUsers" = "extraUsers" + 1 WHERE "companyId" = ${company}`;
      }
      return next(params);
    });
    const events = (type: string) => prisma.subscriptionEvent.count({ where: { companySubscription: { companyId: company }, type: type as never } });

    for (const [action, target] of [["suspend", "suspended"], ["activate", "active"]] as const) {
      if (action === "activate") await setCompanySubscriptionStatus(company, "suspend", "تجهيز");
      const loaded = await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } });
      const eventsBefore = await events(target === "suspended" ? "suspended" : "activated");
      interleave = (status) => (action === "suspend" ? status === "suspended" : status !== "suspended");
      const err = await setCompanySubscriptionStatus(company, action, "قديم", loaded.version).then(() => null, (e) => e);
      expect([action, err?.status, err?.details?.code]).toEqual([action, 409, "subscription_version_conflict"]);
      const after = await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } });
      // الكاتب الآخر وحده كُتب (مستخدم إضافي، نسخة +1)؛ الانتقال لم يُكتب ولا حدثه
      expect([after.status, after.extraUsers, after.version]).toEqual([loaded.status, loaded.extraUsers + 1, loaded.version + 1]);
      expect(err.details.current.version).toBe(after.version);
      expect(await events(target === "suspended" ? "suspended" : "activated")).toBe(eventsBefore);
    }
    await setCompanySubscriptionStatus(company, "activate");

    // والسباق الحقيقي: تغيير إضافات وتعليق متزامنان من النسخة نفسها — لا يمرّان معاً أبداً
    for (let round = 0; round < 5; round++) {
      const v = (await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } })).version;
      const suspendsBefore = await events("suspended");
      const results = await Promise.allSettled([
        updateCompanySubscriptionAddons(company, { extraUsers: round + 10, expectedVersion: v }),
        setCompanySubscriptionStatus(company, "suspend", "سباق", v),
      ]);
      expect(results.filter((r) => r.status === "fulfilled"), `round ${round}`).toHaveLength(1);
      const suspended = results[1].status === "fulfilled";
      const row = await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } });
      expect([row.status === "suspended", await events("suspended")]).toEqual([suspended, suspendsBefore + (suspended ? 1 : 0)]);
      if (suspended) await setCompanySubscriptionStatus(company, "activate");
    }
  });

  it("the general subscription PUT never moves a row into or out of suspended, never changes a suspended row's status, and never creates one suspended", async () => {
    const company = (await prisma.company.create({ data: { tenantId: tenantB, name: `انتقال ${stamp}` } })).id;
    const put = (over: Partial<Parameters<typeof upsertCompanySubscription>[1]>) =>
      upsertCompanySubscription(company, { plan: "basic", billingPeriod: "yearly", status: "active", ...term(30), enforced: false, ...over });
    const refused = "تعليق الاشتراك وتفعيله من إجراء التعليق/التفعيل وحده";
    await expect(put({ status: "suspended", expectedVersion: null })).rejects.toThrow(refused);
    expect(await prisma.companySubscription.findUnique({ where: { companyId: company } })).toBeNull();

    await put({ expectedVersion: null });
    await expect(put({ status: "suspended", expectedVersion: 0 })).rejects.toThrow(refused);
    expect((await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } })).version).toBe(0);

    await setCompanySubscriptionStatus(company, "suspend", "مراجعة");
    const suspended = await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } });
    for (const status of ["active", "grace", "expired", "trialing", "canceled", "awaiting_payment"] as const) {
      await expect(put({ status, expectedVersion: suspended.version }), status).rejects.toThrow(refused);
    }
    expect(await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } })).toEqual(suspended);
    // صف معلّق يبقى معلّقاً: تعديل باقته أو تواريخه مسموح، وحالته وسببه كما هما
    const edited = await put({ status: "suspended", plan: "professional", expectedVersion: suspended.version });
    expect([edited.status, edited.plan, edited.suspensionReason]).toEqual(["suspended", "professional", "مراجعة"]);
    // والمسار المخصَّص يبقى الطريق الوحيد للخروج
    expect((await setCompanySubscriptionStatus(company, "activate", undefined, edited.version)).status).toBe("active");
  });

  it("passes the loaded version from each platform route to the service (PUT, add-ons, status)", async () => {
    const company = (await prisma.company.create({ data: { tenantId: tenantB, name: `مسار ${stamp}` } })).id;
    await upsertCompanySubscription(company, { plan: "basic", billingPeriod: "yearly", status: "active", ...term(30), enforced: false, expectedVersion: null });
    const handlerOf = (method: string, path: string) => {
      const layer = (platformAdminRoutes as unknown as { stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Function }[] } }[] }).stack
        .find((l) => l.route?.path === path && l.route.methods[method]);
      const stack = layer!.route!.stack;
      return stack[stack.length - 1].handle as (req: unknown, res: unknown) => Promise<void>;
    };
    const call = async (method: string, path: string, body: Record<string, unknown>) => {
      const res = { json: () => undefined };
      return handlerOf(method, path)({ params: { companyId: company }, body }, res).then(() => null, (e: { status: number }) => e.status);
    };
    const term2 = { currentPeriodStart: term(30).currentPeriodStart, currentPeriodEnd: term(30).currentPeriodEnd };
    expect(await call("put", "/companies/:companyId/subscription", { plan: "basic", billingPeriod: "yearly", status: "active", enforced: false, ...term2, expectedVersion: 99 })).toBe(409);
    expect(await call("patch", "/companies/:companyId/subscription/addons", { extraUsers: 1, expectedVersion: 99 })).toBe(409);
    expect(await call("patch", "/companies/:companyId/subscription/status", { action: "suspend", reason: "مسار", expectedVersion: 99 })).toBe(409);
    expect((await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company } })).version).toBe(0);
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
