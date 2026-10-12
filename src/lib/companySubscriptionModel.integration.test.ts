import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { register } from "../modules/auth/auth.service";

/**
 * المرحلة P1 من docs/design/subscription-plans.md: جداول الاشتراك لكل شركة. المُنتِج هنا هو الترحيل نفسه
 * (20261012055735_company_subscriptions_data_model) — كل ما يُفحَص يُقرأ من قاعدة طُبِّق عليها، والمستأجرون
 * يُنشَؤون بمسار التسجيل الحقيقي (register). لا كود يقرأ هذه الجداول بعد، فلا يوجد سلوك آخر يُختبَر.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let a = { tenantId: "", companyId: "", userId: "", identityId: "" };
let b = { tenantId: "", companyId: "", userId: "" };

async function setup(tag: string) {
  const r = await register({ tenantName: `اشتراكات ${tag} ${stamp}`, businessActivity: "retail", name: `مالك ${tag}`, email: `subm-${tag}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
  return { tenantId: r.tenant.id, companyId: company.id, userId: user.id, identityId: user.identityId };
}

const DAY = 86_400_000;
const validRow = (companyId: string, identityId: string | null) => ({
  companyId,
  ownerIdentityId: identityId,
  plan: "basic" as const,
  billingPeriod: "yearly" as const,
  status: "active" as const,
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(Date.now() + 365 * DAY),
});

describe("company subscriptions data model (P1)", () => {
  beforeAll(async () => {
    a = await setup("a");
    b = await setup("b");
  }, 120_000);

  it("seeds the owner-approved yearly prices (POS price = each additional POS user); stations and stables stay unpriced", async () => {
    const rows = await prisma.planPrice.findMany({ where: { id: { startsWith: "plan_price_seed_" } } });
    const byItem = Object.fromEntries(rows.map((r) => [r.item, r.yearlyNetPrice == null ? null : r.yearlyNetPrice.toFixed(2)]));
    expect(byItem).toEqual({
      plan_basic: "500.00",
      plan_professional: "1000.00",
      plan_enterprise: "1500.00",
      addon_user: "120.00",
      addon_pos_extra_user: "600.00",
      addon_stations: null,
      addon_stables: null,
    });
  });

  it("changes no behaviour: signing up creates no subscription or POS rows and sets no new identity fields", async () => {
    expect(await prisma.companySubscription.count({ where: { companyId: { in: [a.companyId, b.companyId] } } })).toBe(0);
    expect(await prisma.companyPosUser.count({ where: { companyId: { in: [a.companyId, b.companyId] } } })).toBe(0);
    const identity = await prisma.identity.findUniqueOrThrow({ where: { id: a.identityId } });
    expect([identity.emailVerifiedAt, identity.trialConsumedAt]).toEqual([null, null]);
  });

  it("requires a real end date unless the row is a marked legacy row, and never enforces a legacy row", async () => {
    const { currentPeriodEnd: _end, ...noEnd } = validRow(b.companyId, null);
    await expect(prisma.companySubscription.create({ data: noEnd })).rejects.toThrow(/company_subscriptions_end_required/);
    await expect(prisma.companySubscription.create({ data: { ...noEnd, legacyOpenEnded: true, enforced: true } })).rejects.toThrow(/company_subscriptions_legacy_not_enforced/);
    await expect(
      prisma.companySubscription.create({ data: { ...validRow(b.companyId, null), currentPeriodEnd: new Date(Date.now() - DAY) } }),
    ).rejects.toThrow(/company_subscriptions_period_order/);
    await expect(prisma.companySubscription.create({ data: { ...validRow(b.companyId, null), discountPct: 60 } })).rejects.toThrow(/company_subscriptions_discount_range/);
    await expect(prisma.companySubscription.create({ data: { ...validRow(b.companyId, null), posEnabled: true, posUsers: -1 } })).rejects.toThrow(/company_subscriptions_amounts_nonnegative/);
    // مقاعد نقطة بيع إضافية مدفوعة بلا تفعيل نقطة البيع — مرفوضة (المقعد الأول مجاني ضمن التفعيل)
    await expect(prisma.companySubscription.create({ data: { ...validRow(b.companyId, null), posUsers: 1 } })).rejects.toThrow(/company_subscriptions_pos_requires_enabled/);

    const legacy = await prisma.companySubscription.create({ data: { ...noEnd, legacyOpenEnded: true } });
    expect(legacy.enforced).toBe(false);
    await expect(prisma.companySubscription.update({ where: { id: legacy.id }, data: { enforced: true } })).rejects.toThrow(/company_subscriptions_legacy_not_enforced/);
  });

  it("keeps one subscription per company and an append-only event log", async () => {
    // نقطة بيع مفعّلة بمستخدم إضافي واحد مدفوع (الحد 1 + 1)؛ وتعطيلها مع بقاء مقعد مدفوع مرفوض
    const sub = await prisma.companySubscription.create({ data: { ...validRow(a.companyId, a.identityId), discountRank: 2, discountPct: 20, netPrice: 400, posEnabled: true, posUsers: 1 } });
    await expect(prisma.companySubscription.update({ where: { id: sub.id }, data: { posEnabled: false } })).rejects.toThrow(/company_subscriptions_pos_requires_enabled/);
    await expect(prisma.companySubscription.create({ data: validRow(a.companyId, a.identityId) })).rejects.toThrow(/Unique constraint/);

    const event = await prisma.subscriptionEvent.create({ data: { companySubscriptionId: sub.id, type: "created", after: { plan: "basic" }, actor: "system_job" } });
    await expect(prisma.subscriptionEvent.update({ where: { id: event.id }, data: { actor: "edited" } })).rejects.toThrow(/append-only: UPDATE/);
    await expect(prisma.subscriptionEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only: DELETE/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "subscription_events"`)).rejects.toThrow(/append-only: TRUNCATE/);
    // الاشتراك نفسه لا يُحذف ما دام له سجل
    await expect(prisma.companySubscription.delete({ where: { id: sub.id } })).rejects.toThrow();
    expect(await prisma.subscriptionEvent.count({ where: { companySubscriptionId: sub.id } })).toBe(1);
  });

  it("freezes a price once in effect; a scheduled price can change until its date but not be moved into effect", async () => {
    await expect(prisma.planPrice.update({ where: { id: "plan_price_seed_basic" }, data: { yearlyNetPrice: 1 } })).rejects.toThrow(/already in effect/);
    await expect(prisma.planPrice.delete({ where: { id: "plan_price_seed_basic" } })).rejects.toThrow(/already in effect/);

    const future = new Date(Date.UTC(2900 + (stamp % 90), 0, 1));
    const scheduled = await prisma.planPrice.create({ data: { item: "plan_basic", yearlyNetPrice: 550, effectiveFrom: future } });
    const edited = await prisma.planPrice.update({ where: { id: scheduled.id }, data: { yearlyNetPrice: 560 } });
    expect(edited.yearlyNetPrice?.toFixed(2)).toBe("560.00");
    await expect(prisma.planPrice.update({ where: { id: scheduled.id }, data: { effectiveFrom: new Date() } })).rejects.toThrow(/cannot be moved/);
    await prisma.planPrice.delete({ where: { id: scheduled.id } });
    await expect(prisma.planPrice.create({ data: { item: "addon_pos_extra_user", yearlyNetPrice: -1, effectiveFrom: future } })).rejects.toThrow(/plan_prices_nonnegative/);
  });

  it("assigns POS users only within the company's own tenant", async () => {
    const ok = await prisma.companyPosUser.create({ data: { companyId: a.companyId, userId: a.userId, assignedByUserId: a.userId } });
    await expect(prisma.companyPosUser.create({ data: { companyId: a.companyId, userId: a.userId } })).rejects.toThrow(/Unique constraint/);
    // عضو المستأجر ب على شركة المستأجر أ — مرفوض، إدراجاً وتعديلاً
    await expect(prisma.companyPosUser.create({ data: { companyId: a.companyId, userId: b.userId } })).rejects.toThrow(/is not a member of the tenant/);
    await expect(prisma.companyPosUser.update({ where: { id: ok.id }, data: { userId: b.userId } })).rejects.toThrow(/is not a member of the tenant/);
    await expect(prisma.companyPosUser.update({ where: { id: ok.id }, data: { companyId: b.companyId } })).rejects.toThrow(/is not a member of the tenant/);
    expect(await prisma.companyPosUser.count({ where: { companyId: b.companyId } })).toBe(0);
  });
});
