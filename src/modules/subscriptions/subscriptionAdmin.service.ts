import type { ActivityAddonState, BillingPeriod, CompanySubscriptionStatus, PlanPriceItem, Prisma, SubscriptionPlan } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { clearSubscriptionEnforcementCache, ENFORCEMENT_SETTING_KEY, MESSAGES, occupiedUserSeats, posSeatCapacity } from "../../lib/subscriptionEnforcement";
import { companyEntitlements, userLimit } from "../../lib/subscriptionPlans";
import { readOnlyAt, graceEndsAt } from "../../lib/subscriptionLifecycle";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { planPricesAt, rankOwnerCompanies } from "./subscriptionPreview.service";
import { activateCompanySubscription, suspendCompanySubscription } from "./subscriptionLifecycle.service";

/**
 * إدارة الإنفاذ من لوحة مدير المنصة (P4 — جزء من P8 قُدِّم لأن تجربة الإنفاذ على شركة واحدة بعد النشر تحتاجه): المفتاح الشامل،
 * وصفّ اشتراك شركة، وتعيين مستخدمي نقطة البيع. كل تغيير على اشتراك شركة يُكتب حدثاً في subscription_events.
 */

const ACTOR = "platform_admin";

export async function getEnforcementSwitch() {
  const row = await prisma.platformSetting.findUnique({ where: { key: ENFORCEMENT_SETTING_KEY } });
  return { enabled: row?.value === true, updatedAt: row?.updatedAt ?? null };
}

export async function setEnforcementSwitch(enabled: boolean) {
  const row = await prisma.platformSetting.upsert({
    where: { key: ENFORCEMENT_SETTING_KEY },
    create: { key: ENFORCEMENT_SETTING_KEY, value: enabled },
    update: { value: enabled },
  });
  clearSubscriptionEnforcementCache();
  return { enabled: row.value === true, updatedAt: row.updatedAt };
}

export type CompanySubscriptionInput = {
  plan: SubscriptionPlan;
  billingPeriod: BillingPeriod;
  status: CompanySubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  enforced: boolean;
  posEnabled?: boolean;
  posUsers?: number;
  extraUsers?: number;
  stationsAddon?: ActivityAddonState;
  stablesAddon?: ActivityAddonState;
};

const snapshot = (row: Record<string, unknown>) => JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject;

/**
 * ينشئ صف اشتراك الشركة أو يحدّثه بتاريخ نهاية حقيقي (لا صف "قديم بلا نهاية" من هنا)، مع حدث بالقيم قبل وبعد.
 * الإضافات (نقطة البيع ومقاعدها، المستخدمون الإضافيون) اختيارية في الطلب: الافتراضي (معطّلة، صفر) عند الإنشاء فقط؛ عند التحديث يبقى
 * الحقل الغائب على قيمته الحالية (مراجعة #164) — فتغيير الباقة أو التواريخ لا يُطفئ نقطة البيع ولا يصفّر مقاعد مدفوعة. وبنفس قواعد مسار
 * الإضافات: لا مقاعد نقطة بيع بلا تفعيلها، ولا سعة أقل من المعيَّنين فعلاً.
 */
export async function upsertCompanySubscription(companyId: string, input: CompanySubscriptionInput) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, tenant: { select: { ownerId: true } } } });
  if (!company) throw notFound("الشركة غير موجودة");
  const owner = company.tenant.ownerId ? await prisma.user.findUnique({ where: { id: company.tenant.ownerId }, select: { identityId: true } }) : null;
  const data = {
    plan: input.plan,
    billingPeriod: input.billingPeriod,
    status: input.status,
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    legacyOpenEnded: false,
    enforced: input.enforced,
    ...(input.posEnabled !== undefined ? { posEnabled: input.posEnabled } : {}),
    ...(input.posUsers !== undefined ? { posUsers: input.posUsers } : {}),
    ...(input.extraUsers !== undefined ? { extraUsers: input.extraUsers } : {}),
    ...(input.stationsAddon ? { stationsAddon: input.stationsAddon } : {}),
    ...(input.stablesAddon ? { stablesAddon: input.stablesAddon } : {}),
    ownerIdentityId: owner?.identityId ?? null,
  };
  const existing = await prisma.companySubscription.findUnique({ where: { companyId }, select: { posEnabled: true, posUsers: true } });
  const pos = {
    posEnabled: input.posEnabled ?? existing?.posEnabled ?? false,
    posUsers: input.posUsers ?? (input.posEnabled === false ? 0 : existing?.posUsers ?? 0),
  };
  if (pos.posUsers > 0 && !pos.posEnabled) throw badRequest(MESSAGES.posDisabled);
  if ((await prisma.companyPosUser.count({ where: { companyId } })) > posSeatCapacity(pos)) {
    throw badRequest("عدد مستخدمي نقطة البيع المعيَّنين أكبر من السعة الجديدة — أزل بعض التعيينات أولاً");
  }
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.companySubscription.findUnique({ where: { companyId } });
    const after = before
      ? await tx.companySubscription.update({ where: { companyId }, data: { ...data, ...(input.posEnabled === false ? { posUsers: 0 } : {}) } })
      : await tx.companySubscription.create({ data: { companyId, posEnabled: false, posUsers: 0, extraUsers: 0, ...data } });
    await tx.subscriptionEvent.create({
      data: { companySubscriptionId: after.id, type: before ? "migrated" : "created", before: before ? snapshot(before) : undefined, after: snapshot(after), actor: ACTOR },
    });
    return after;
  });
  clearSubscriptionEnforcementCache();
  return result;
}

/** يستبدل مستخدمي نقطة البيع المعيَّنين للشركة (D19) ضمن السعة: 1 مجاني + المقاعد الإضافية (D27). مشغّل القاعدة يرفض عضواً من مستأجر آخر */
export async function setCompanyPosUsers(companyId: string, userIds: string[]) {
  const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
  if (!sub) throw notFound("لا يوجد اشتراك لهذه الشركة");
  const unique = [...new Set(userIds)];
  if (unique.length > 0 && !sub.posEnabled) throw badRequest(MESSAGES.posDisabled);
  if (unique.length > posSeatCapacity(sub)) throw badRequest(MESSAGES.posSeatsFull);
  const result = await prisma.$transaction(async (tx) => {
    const before = (await tx.companyPosUser.findMany({ where: { companyId }, select: { userId: true } })).map((r) => r.userId);
    await tx.companyPosUser.deleteMany({ where: { companyId, userId: { notIn: unique } } });
    if (unique.length) await tx.companyPosUser.createMany({ data: unique.map((userId) => ({ companyId, userId })), skipDuplicates: true });
    await tx.subscriptionEvent.create({
      data: { companySubscriptionId: sub.id, type: "pos_users_changed", before: { userIds: before.sort() }, after: { userIds: [...unique].sort() }, actor: ACTOR },
    });
    return (await tx.companyPosUser.findMany({ where: { companyId }, select: { userId: true } })).map((r) => r.userId).sort();
  });
  clearSubscriptionEnforcementCache();
  return { companyId, userIds: result, capacity: posSeatCapacity(sub) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// المرحلة P8: بقية واجهة لوحة مدير المنصة الداخلية (docs/design/subscription-plans.md §9) عدا ما يعتمد على الفوترة (P7). كلها خلف
// مفتاح خدمة المنصة، ولا تغيّر شيئاً لأي مستخدم إلا حين يتصرّف المدير صراحةً.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type SubscriptionRow = Awaited<ReturnType<typeof prisma.companySubscription.findUnique>>;

function subscriptionView(sub: NonNullable<SubscriptionRow>, now: Date) {
  const end = sub.currentPeriodEnd;
  return {
    plan: sub.plan,
    billingPeriod: sub.billingPeriod,
    status: sub.status,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: end,
    legacyOpenEnded: sub.legacyOpenEnded,
    /** للفترة المدفوعة: آخر يوم كتابة قبل "عرض فقط" (D23)؛ للتجربة: نهايتها (D28) */
    readOnlyFrom: end ? (sub.status === "trialing" ? end : graceEndsAt(end)) : null,
    readOnlyNow: sub.status === "suspended" || readOnlyAt(sub, now),
    enforced: sub.enforced,
    discountRank: sub.discountRank,
    discountPct: sub.discountPct.toNumber(),
    netPrice: sub.netPrice.toNumber(),
    grandfatheredNetPrice: sub.grandfatheredNetPrice?.toNumber() ?? null,
    scheduledPlan: sub.scheduledPlan,
    scheduledBillingPeriod: sub.scheduledBillingPeriod,
    extraUsers: sub.extraUsers,
    posEnabled: sub.posEnabled,
    posUsers: sub.posUsers,
    stationsAddon: sub.stationsAddon,
    stablesAddon: sub.stablesAddon,
    suspensionReason: sub.suspensionReason,
    updatedAt: sub.updatedAt,
  };
}

/**
 * نظرة عامة لكل الشركات (§9): المستأجر، المالك، الاشتراك إن وُجد (وإلا null = سلوك اليوم)، المقاعد المشغولة مقابل الحد، مقاعد نقطة
 * البيع المعيَّنة مقابل السعة، الترتيب الحي بين شركات هوية المالك، وعلَم تجاوز الحد. تصفية اختيارية بالمستأجر أو حالة الاشتراك أو نص.
 */
export async function listCompanySubscriptions(filter: { tenantId?: string; status?: CompanySubscriptionStatus | "none"; q?: string } = {}, now: Date = new Date()) {
  const companies = await prisma.company.findMany({
    where: {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { tenant: { name: { contains: filter.q, mode: "insensitive" } } }] } : {}),
      ...(filter.status === "none" ? { subscription: null } : filter.status ? { subscription: { status: filter.status } } : {}),
    },
    select: {
      id: true,
      name: true,
      businessActivity: true,
      createdAt: true,
      tenant: { select: { id: true, code: true, name: true, ownerId: true, subscriptionStatus: true, subscriptionPlan: true, trialEndsAt: true } },
      subscription: true,
      _count: { select: { posUsers: true } },
    },
    orderBy: [{ tenant: { name: "asc" } }, { createdAt: "asc" }],
  });

  const ownerIds = [...new Set(companies.map((c) => c.tenant.ownerId).filter((id): id is string => !!id))];
  const owners = await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, identityId: true, identity: { select: { email: true } } } });
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const rankByCompany = new Map<string, number>();
  for (const identityId of new Set(owners.map((o) => o.identityId))) {
    for (const r of await rankOwnerCompanies(identityId, now)) rankByCompany.set(r.companyId, r.rank);
  }

  const rows = [];
  for (const c of companies) {
    const owner = c.tenant.ownerId ? ownerById.get(c.tenant.ownerId) : undefined;
    const occupied = await occupiedUserSeats(c.tenant.id, c.id);
    const sub = c.subscription;
    const limit = sub ? userLimit(sub.plan, sub.extraUsers) : null;
    const posCapacity = sub ? posSeatCapacity(sub) : null;
    rows.push({
      companyId: c.id,
      companyName: c.name,
      businessActivity: c.businessActivity,
      tenant: { id: c.tenant.id, code: c.tenant.code, name: c.tenant.name, legacyStatus: c.tenant.subscriptionStatus, legacyPlan: c.tenant.subscriptionPlan, legacyTrialEndsAt: c.tenant.trialEndsAt },
      ownerEmail: owner?.identity.email ?? null,
      liveRank: rankByCompany.get(c.id) ?? null,
      subscription: sub ? subscriptionView(sub, now) : null,
      users: { occupied, limit, overLimit: limit !== null && occupied > limit },
      pos: { assigned: c._count.posUsers, capacity: posCapacity },
    });
  }
  return rows;
}

/** تفاصيل اشتراك شركة لشاشة الشركة: الاشتراك، آخر 50 حدثاً، مستخدمو نقطة البيع المعيَّنون، والأعضاء المؤهَّلون للتعيين */
export async function getCompanySubscriptionDetail(companyId: string, now: Date = new Date()) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, tenantId: true, businessActivity: true, subscription: true },
  });
  if (!company) throw notFound("الشركة غير موجودة");
  const sub = company.subscription;
  const [events, assignments, members] = await Promise.all([
    sub ? prisma.subscriptionEvent.findMany({ where: { companySubscriptionId: sub.id }, orderBy: { at: "desc" }, take: 50 }) : [],
    prisma.companyPosUser.findMany({ where: { companyId }, select: { userId: true, assignedAt: true }, orderBy: { assignedAt: "asc" } }),
    prisma.user.findMany({
      where: { tenantId: company.tenantId, active: true, deletedAt: null, inviteStatus: "accepted", companyScope: { in: ["all", companyId] } },
      select: { id: true, name: true, role: true, companyScope: true, identity: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const occupied = await occupiedUserSeats(company.tenantId, companyId);
  return {
    companyId,
    companyName: company.name,
    subscription: sub ? subscriptionView(sub, now) : null,
    modules: sub ? [...companyEntitlements({ ...sub, businessActivity: company.businessActivity }).modules].sort() : null,
    users: { occupied, limit: sub ? userLimit(sub.plan, sub.extraUsers) : null },
    pos: { assignedUserIds: assignments.map((a) => a.userId), capacity: sub ? posSeatCapacity(sub) : null },
    members: members.map(({ identity, ...m }) => ({ ...m, email: identity.email })),
    events,
  };
}

/** تعليق/إعادة تفعيل (P3): إعادة التفعيل تعود إلى الحالة التي يستحقها الاشتراك بالتاريخ، لا "نشط بلا نهاية" */
export async function setCompanySubscriptionStatus(companyId: string, action: "suspend" | "activate", reason?: string) {
  const result = action === "suspend" ? await suspendCompanySubscription(companyId, reason ?? "", ACTOR) : await activateCompanySubscription(companyId, ACTOR);
  clearSubscriptionEnforcementCache();
  return result;
}

export type AddonsPatch = {
  extraUsers?: number;
  posEnabled?: boolean;
  posUsers?: number;
  stationsAddon?: ActivityAddonState;
  stablesAddon?: ActivityAddonState;
};

/**
 * كميات الإضافات وحالتها (§9). لا تُنقَص سعة نقطة البيع تحت عدد المعيَّنين فعلاً (يُزال التعيين أولاً)، ولا مقاعد إضافية بلا تفعيل
 * نقطة البيع (D27). إنقاص المستخدمين الإضافيين لا يُخرج أحداً (§5.3)؛ تُظهره القائمة "متجاوزاً للحد" فقط.
 */
export async function updateCompanySubscriptionAddons(companyId: string, patch: AddonsPatch) {
  const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
  if (!sub) throw notFound("لا يوجد اشتراك لهذه الشركة");
  const next = {
    extraUsers: patch.extraUsers ?? sub.extraUsers,
    posEnabled: patch.posEnabled ?? sub.posEnabled,
    posUsers: patch.posUsers ?? (patch.posEnabled === false ? 0 : sub.posUsers),
    stationsAddon: patch.stationsAddon ?? sub.stationsAddon,
    stablesAddon: patch.stablesAddon ?? sub.stablesAddon,
  };
  if (next.posUsers > 0 && !next.posEnabled) throw badRequest(MESSAGES.posDisabled);
  const assigned = await prisma.companyPosUser.count({ where: { companyId } });
  if (assigned > posSeatCapacity(next)) throw badRequest("عدد مستخدمي نقطة البيع المعيَّنين أكبر من السعة الجديدة — أزل بعض التعيينات أولاً");
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.companySubscription.update({ where: { companyId }, data: next });
    await tx.subscriptionEvent.create({
      data: {
        companySubscriptionId: sub.id,
        type: "addons_changed",
        before: { extraUsers: sub.extraUsers, posEnabled: sub.posEnabled, posUsers: sub.posUsers, stationsAddon: sub.stationsAddon, stablesAddon: sub.stablesAddon },
        after: next,
        actor: ACTOR,
      },
    });
    return updated;
  });
  clearSubscriptionEnforcementCache();
  return result;
}

/** كتالوج الأسعار (§9): كل الصفوف (السارية والمجدولة) والسعر الساري اليوم لكل بند */
export async function listPlanPrices(now: Date = new Date()) {
  const [rows, current] = await Promise.all([
    prisma.planPrice.findMany({ orderBy: [{ item: "asc" }, { effectiveFrom: "asc" }] }),
    planPricesAt(now),
  ]);
  const today = riyadhCalendarDay(now);
  return {
    today,
    current,
    rows: rows.map((r) => {
      const effectiveFrom = r.effectiveFrom.toISOString().slice(0, 10);
      return { id: r.id, item: r.item, yearlyNetPrice: r.yearlyNetPrice?.toNumber() ?? null, effectiveFrom, scheduled: effectiveFrom > today };
    }),
  };
}

/** يجدول سعراً جديداً بتاريخ سريان بعد اليوم (بتوقيت الرياض) — الصف الساري لا يُعدَّل (مشغّل القاعدة يحميه أيضاً) */
export async function schedulePlanPrice(input: { item: PlanPriceItem; yearlyNetPrice: number | null; effectiveFrom: string }, now: Date = new Date()) {
  if (input.effectiveFrom <= riyadhCalendarDay(now)) throw badRequest("تاريخ سريان السعر الجديد يجب أن يكون بعد اليوم — الأسعار السارية لا تُعدَّل");
  const exists = await prisma.planPrice.findUnique({ where: { item_effectiveFrom: { item: input.item, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`) } } });
  if (exists) throw badRequest("يوجد سعر مجدول لهذا البند في التاريخ نفسه");
  return prisma.planPrice.create({ data: { item: input.item, yearlyNetPrice: input.yearlyNetPrice, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`) } });
}

/** يحذف سعراً مجدولاً لم يسرِ بعد */
export async function deleteScheduledPlanPrice(id: string, now: Date = new Date()) {
  const row = await prisma.planPrice.findUnique({ where: { id } });
  if (!row) throw notFound("السعر غير موجود");
  if (row.effectiveFrom.toISOString().slice(0, 10) <= riyadhCalendarDay(now)) throw badRequest("لا يمكن حذف سعر سارٍ — جدول سعراً جديداً بتاريخ لاحق بدلاً من ذلك");
  await prisma.planPrice.delete({ where: { id } });
  return { deleted: id };
}
