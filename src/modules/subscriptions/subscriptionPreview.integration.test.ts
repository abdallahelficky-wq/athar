import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createIndependentTenant, register } from "../auth/auth.service";
import { planPricesAt, previewSubscriptionPrice, rankOwnerCompanies } from "./subscriptionPreview.service";

/**
 * previewSubscriptionPrice (docs/design/subscription-plans.md §4، §7): الأسعار من plan_prices كما زرعها الترحيل، والمالكون
 * والشركات من مسارات التسجيل الحقيقية (register، createIndependentTenant). صفوف company_subscriptions تُكتَب هنا يدوياً لأن
 * الكود الذي سيُنتجها (P3/P11) لم يُبنَ بعد — هي حالة مدخلة تمثّل ما سيكتبه، لا مُخرَجاً يُفحَص شكله.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const DAY = 86_400_000;
const SAME = `مؤسسة التسعير ${stamp}`;
const now = new Date();
let ownerA = "";
let ownerB = "";
let scopedIdentity = "";
const aCompanies: Record<string, string> = {};
const futureDate = new Date(Date.UTC(3000 + (stamp % 500), 0, 1));
let futurePriceId = "";

async function subscription(companyId: string, data: { status: "active" | "grace" | "expired" | "suspended" | "canceled"; endDaysFromNow: number; expiredEventDaysAgo?: number }) {
  const end = new Date(now.getTime() + data.endDaysFromNow * DAY);
  const sub = await prisma.companySubscription.create({
    data: { companyId, plan: "basic", billingPeriod: "yearly", status: data.status, currentPeriodStart: new Date(end.getTime() - 365 * DAY), currentPeriodEnd: end },
  });
  if (data.expiredEventDaysAgo != null) {
    await prisma.subscriptionEvent.create({ data: { companySubscriptionId: sub.id, type: "expired", actor: "system_job", at: new Date(now.getTime() - data.expiredEventDaysAgo * DAY) } });
  }
}

describe("previewSubscriptionPrice", () => {
  beforeAll(async () => {
    const a = await register({ tenantName: SAME, businessActivity: "retail", name: "مالك أ", email: `prev-a-${stamp}@example.com`, password: "Str0ng-Pass!" });
    const first = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    ownerA = (await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).identityId;
    aCompanies.first = first.id;
    // شركة مستقلة (مستأجر آخر لنفس الهوية) ثم شركات مجموعة بحالات مختلفة — بترتيب إنشاء معروف
    const ind = await createIndependentTenant(a.user.id, { name: `مستقلة ${stamp}`, businessActivity: "retail" });
    await prisma.company.update({ where: { id: ind.company.id }, data: { createdAt: new Date(first.createdAt.getTime() + 1000) } });
    aCompanies.independent = ind.company.id;
    const names = ["canceled", "suspended", "expired10", "expired40", "expiredNoEvent", "grace"];
    for (const [i, name] of names.entries()) {
      const c = await prisma.company.create({ data: { tenantId: a.tenant.id, name: `${name} ${stamp}`, createdAt: new Date(first.createdAt.getTime() + (i + 2) * 1000) } });
      aCompanies[name] = c.id;
    }
    await subscription(aCompanies.canceled, { status: "canceled", endDaysFromNow: 100 });
    await subscription(aCompanies.suspended, { status: "suspended", endDaysFromNow: 100 });
    await subscription(aCompanies.expired10, { status: "expired", endDaysFromNow: -17, expiredEventDaysAgo: 10 });
    await subscription(aCompanies.expired40, { status: "expired", endDaysFromNow: -47, expiredEventDaysAgo: 40 });
    await subscription(aCompanies.expiredNoEvent, { status: "expired", endDaysFromNow: -45 });
    await subscription(aCompanies.grace, { status: "grace", endDaysFromNow: -2 });

    // عضو مقيَّد في مستأجر أ: هويته لا تملك أي مستأجر
    const scoped = await prisma.identity.create({ data: { email: `prev-scoped-${stamp}@example.com` } });
    await prisma.user.create({ data: { tenantId: a.tenant.id, identityId: scoped.id, name: "مقيَّد", role: "accountant", inviteStatus: "accepted", companyScope: first.id } });
    scopedIdentity = scoped.id;

    // مالك آخر بشركة بالاسم نفسه
    const b = await register({ tenantName: SAME, businessActivity: "retail", name: "مالك ب", email: `prev-b-${stamp}@example.com`, password: "Str0ng-Pass!" });
    ownerB = (await prisma.user.findUniqueOrThrow({ where: { id: b.user.id } })).identityId;

    futurePriceId = (await prisma.planPrice.create({ data: { item: "plan_basic", yearlyNetPrice: 700, effectiveFrom: futureDate } })).id;
  }, 120_000);

  afterAll(async () => {
    if (futurePriceId) await prisma.planPrice.delete({ where: { id: futurePriceId } });
  });

  it("reads the migration-seeded prices in effect today", async () => {
    const p = await planPricesAt(now);
    expect([p.plan_basic, p.plan_professional, p.plan_enterprise, p.addon_user, p.addon_pos_extra_user, p.addon_stations, p.addon_stables]).toEqual([500, 1000, 1500, 120, 600, null, null]);
  });

  it("ranks an owner's live companies across tenants by creation; drops canceled, suspended and companies read-only for more than 30 days (D21)", async () => {
    const ranked = await rankOwnerCompanies(ownerA, now);
    expect(ranked.map((r) => r.companyId)).toEqual([aCompanies.first, aCompanies.independent, aCompanies.expired10, aCompanies.grace]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    // شركة منتهية بلا حدث: يُقاس من تاريخ نهايتها (قبل 45 يوماً) فتسقط؛ والمنتهية قبل 40 يوماً تسقط؛ وقبل 10 أيام تبقى
    // بعد 25 يوماً أخرى تتجاوز الشركة المنتهية منذ 10 أيام حدّ الثلاثين يوماً فتسقط هي أيضاً
    const later = await rankOwnerCompanies(ownerA, new Date(now.getTime() + 25 * DAY));
    expect(later.map((r) => r.companyId)).not.toContain(aCompanies.expired10);
  });

  it("prices a new company at the next rank: owner A has 4 live companies, so the 5th gets the 50% cap", async () => {
    const q = await previewSubscriptionPrice(ownerA, "basic", "yearly", {}, now);
    expect(q).toMatchObject({ rank: 5, net: 250, vat: 37.5, total: 287.5 });
    expect(q.lines[0]).toMatchObject({ kind: "plan", discountPct: 50 });
  });

  it("keeps another owner's same-named company apart: owner B's second company is rank 2 (20%)", async () => {
    expect(await previewSubscriptionPrice(ownerB, "basic", "yearly", {}, now)).toMatchObject({ rank: 2, net: 400, total: 460 });
  });

  it("charges full price to a new signup and to an identity that owns no tenant", async () => {
    expect(await previewSubscriptionPrice(null, "professional", "monthly", {}, now)).toMatchObject({ rank: 1, net: 91.67 });
    expect(await previewSubscriptionPrice(scopedIdentity, "basic", "yearly", {}, now)).toMatchObject({ rank: 1, total: 575 });
  });

  it("includes add-ons undiscounted at any rank, with the free POS seat (D17, D27)", async () => {
    const q = await previewSubscriptionPrice(ownerB, "basic", "yearly", { extraUsers: 3, posEnabled: true, additionalPosUsers: 1 }, now);
    expect(q.lines.map((l) => [l.kind, l.net])).toEqual([["plan", 400], ["extra_users", 360], ["pos_included", 0], ["pos_extra_users", 600]]);
    expect([q.net, q.vat, q.total]).toEqual([1360, 204, 1564]);
  });

  it("uses a scheduled price only from its effective date (KSA day)", async () => {
    const before = await previewSubscriptionPrice(null, "basic", "yearly", {}, new Date(futureDate.getTime() - 4 * 3_600_000));
    expect(before).toMatchObject({ net: 500 });
    // 00:00 بتوقيت الرياض في يوم السريان = 21:00 UTC من اليوم السابق
    const onDay = await previewSubscriptionPrice(null, "basic", "yearly", {}, new Date(futureDate.getTime() - 3 * 3_600_000));
    expect(onDay).toMatchObject({ net: 700, pricesEffectiveOn: futureDate.toISOString().slice(0, 10) });
  });
});
