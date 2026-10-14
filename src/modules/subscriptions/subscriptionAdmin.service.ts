import type { ActivityAddonState, BillingPeriod, CompanySubscriptionStatus, PlanPriceItem, Prisma, SubscriptionPlan } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, HttpError, notFound } from "../../lib/httpError";
import {
  assertPosCapacityHolds,
  clearSubscriptionEnforcementCache,
  ENFORCEMENT_SETTING_KEY,
  lockCompanyPosSeats,
  MESSAGES,
  occupiedUserSeats,
  posSeatCapacity,
} from "../../lib/subscriptionEnforcement";
import { companyEntitlements, userLimit } from "../../lib/subscriptionPlans";
import { readOnlyAt, graceEndsAt } from "../../lib/subscriptionLifecycle";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { NULLABLE_PRICE_ITEMS, PRICE_REQUIRED_MESSAGE } from "../platformAdmin/platformAdmin.schemas";
import { planPricesAt, rankCompaniesByOwnerIdentities } from "./subscriptionPreview.service";
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
  /** نسخة الصف التي حمّلها المدير (P9) — null عند الإنشاء (لا صف بعد). غيابها (نداء داخلي) = بلا فحص */
  expectedVersion?: number | null;
};

const snapshot = (row: Record<string, unknown>) => JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject;

/**
 * ينشئ صف اشتراك الشركة أو يحدّثه بتاريخ نهاية حقيقي (لا صف "قديم بلا نهاية" من هنا)، مع حدث بالقيم قبل وبعد.
 * الإضافات (نقطة البيع ومقاعدها، المستخدمون الإضافيون) اختيارية في الطلب: الافتراضي (معطّلة، صفر) عند الإنشاء فقط؛ عند التحديث يبقى
 * الحقل الغائب على قيمته الحالية (مراجعة #164) — فتغيير الباقة أو التواريخ لا يُطفئ نقطة البيع ولا يصفّر مقاعد مدفوعة. وبنفس قواعد مسار
 * الإضافات: لا مقاعد نقطة بيع بلا تفعيلها، ولا سعة أقل من المعيَّنين فعلاً.
 */
/**
 * التزامن المتفائل (P9): المدير يرسل نسخة الصف التي حمّلها (version، يزيدها مشغّل القاعدة عند كل تحديث من أي كاتب). نسخة لا تطابق
 * الصف الحالي = تعديل آخر سبقه (مدير في تبويب آخر، المُجدوِل، تعليق) — 409 مع الصف الحالي فيعرضه ويقرر، بدل أن يمحو ما لم يره.
 */
export const VERSION_CONFLICT_MESSAGE = "تغيّر اشتراك هذه الشركة منذ فتحته — راجع القيم الحالية ثم أعد الحفظ.";
function versionConflict(current: NonNullable<SubscriptionRow> | null, now: Date = new Date()) {
  return new HttpError(409, VERSION_CONFLICT_MESSAGE, { code: "subscription_version_conflict", current: current ? subscriptionView(current, now) : null });
}
function assertExpectedVersion(current: NonNullable<SubscriptionRow> | null, expected: number | null | undefined) {
  if (expected === undefined) return;
  if ((current?.version ?? null) !== expected) throw versionConflict(current);
}

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
  const result = await prisma.$transaction(async (tx) => {
    // سعة نقطة البيع الناتجة تُحسب وتُفحص تحت قفل مقاعد الشركة نفسه الذي يأخذه تعيين المستخدمين (مراجعة #163): الحقول
    // المحذوفة من الطلب تُؤخذ من الصف المقروء بعد القفل، لا من قراءة سابقة له
    await lockCompanyPosSeats(tx, companyId);
    const existing = await tx.companySubscription.findUnique({ where: { companyId }, select: { posEnabled: true, posUsers: true } });
    await assertPosCapacityHolds(tx, companyId, {
      posEnabled: input.posEnabled ?? existing?.posEnabled ?? false,
      posUsers: input.posUsers ?? (input.posEnabled === false ? 0 : existing?.posUsers ?? 0),
    });
    const before = await tx.companySubscription.findUnique({ where: { companyId } });
    assertExpectedVersion(before, input.expectedVersion);
    let after;
    if (before) {
      // مشروطة بالنسخة المقروءة: كاتب لا يأخذ قفل المقاعد (التعليق، المُجدوِل) بين القراءة والكتابة يُكتشَف هنا أيضاً
      const claim = await tx.companySubscription.updateMany({
        where: { companyId, version: before.version },
        data: { ...data, ...(input.posEnabled === false ? { posUsers: 0 } : {}) },
      });
      if (claim.count === 0) throw versionConflict(await tx.companySubscription.findUnique({ where: { companyId } }));
      after = await tx.companySubscription.findUniqueOrThrow({ where: { companyId } });
    } else {
      after = await tx.companySubscription.create({ data: { companyId, posEnabled: false, posUsers: 0, extraUsers: 0, ...data } });
    }
    await tx.subscriptionEvent.create({
      data: { companySubscriptionId: after.id, type: before ? "migrated" : "created", before: before ? snapshot(before) : undefined, after: snapshot(after), actor: ACTOR },
    });
    return after;
  });
  clearSubscriptionEnforcementCache();
  return result;
}

/** يستبدل مستخدمي نقطة البيع المعيَّنين للشركة (D19) ضمن السعة: 1 مجاني + المقاعد الإضافية (D27). مشغّل القاعدة يرفض عضواً من مستأجر آخر */
/**
 * من يصلح لمقعد نقطة بيع في شركة: عضوية فعّالة غير محذوفة، دعوتها مقبولة، نطاقها "all" أو هذه الشركة، من مستأجر الشركة نفسه. شرط
 * واحد يعرض به التفصيل "الأعضاء المؤهَّلين" ويُفحَص به التعيين (مراجعة #164) — لا مقعد لعضو من مستأجر آخر أو شركة أخرى أو معطَّل.
 */
export function posEligibleMemberWhere(tenantId: string, companyId: string): Prisma.UserWhereInput {
  return { tenantId, active: true, deletedAt: null, inviteStatus: "accepted", companyScope: { in: ["all", companyId] } };
}

export async function setCompanyPosUsers(companyId: string, userIds: string[]) {
  const unique = [...new Set(userIds)];
  // الفحص والاستبدال تحت قفل مقاعد الشركة، على صف الاشتراك كما هو بعد القفل (مراجعة #163) — لا قراءة للسعة خارج المعاملة
  const { sub, result } = await prisma.$transaction(async (tx) => {
    await lockCompanyPosSeats(tx, companyId);
    const sub = await tx.companySubscription.findUnique({ where: { companyId } });
    if (!sub) throw notFound("لا يوجد اشتراك لهذه الشركة");
    if (unique.length > 0 && !sub.posEnabled) throw badRequest(MESSAGES.posDisabled);
    if (unique.length > posSeatCapacity(sub)) throw badRequest(MESSAGES.posSeatsFull);
    if (unique.length) {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true } });
      const eligible = await tx.user.count({ where: { ...posEligibleMemberWhere(company.tenantId, companyId), id: { in: unique } } });
      if (eligible !== unique.length) throw badRequest(MESSAGES.posAssigneeNotEligible);
    }
    const before = (await tx.companyPosUser.findMany({ where: { companyId }, select: { userId: true } })).map((r) => r.userId);
    await tx.companyPosUser.deleteMany({ where: { companyId, userId: { notIn: unique } } });
    if (unique.length) await tx.companyPosUser.createMany({ data: unique.map((userId) => ({ companyId, userId })), skipDuplicates: true });
    await tx.subscriptionEvent.create({
      data: { companySubscriptionId: sub.id, type: "pos_users_changed", before: { userIds: before.sort() }, after: { userIds: [...unique].sort() }, actor: ACTOR },
    });
    const after = (await tx.companyPosUser.findMany({ where: { companyId }, select: { userId: true } })).map((r) => r.userId).sort();
    await assertPosCapacityHolds(tx, companyId, sub, after.length);
    return { sub, result: after };
  });
  clearSubscriptionEnforcementCache();
  return { companyId, userIds: result, capacity: posSeatCapacity(sub) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// المرحلة P8: بقية واجهة لوحة مدير المنصة الداخلية (docs/design/subscription-plans.md §9) عدا ما يعتمد على الفوترة (P7). كلها خلف
// مفتاح خدمة المنصة، ولا تغيّر شيئاً لأي مستخدم إلا حين يتصرّف المدير صراحةً.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type SubscriptionRow = Awaited<ReturnType<typeof prisma.companySubscription.findUnique>>;

/**
 * متى تصبح الشركة "عرض فقط"، من الحالة (مراجعة #164): الحالات التي لا كتابة فيها أصلاً (بانتظار الدفع، ملغاة، معلّقة، منتهية) فوراً؛
 * التجربة عند نهايتها بلا سماح (D28)؛ الفترة المدفوعة النشطة أو في السماح عند النهاية + 7 أيام (D23). صف قديم بلا نهاية = null.
 */
export function readOnlyFrom(sub: { status: CompanySubscriptionStatus; currentPeriodEnd: Date | null }, now: Date): Date | null {
  const end = sub.currentPeriodEnd;
  switch (sub.status) {
    case "awaiting_payment":
    case "canceled":
    case "suspended":
    case "expired":
      return now;
    case "trialing":
      return end;
    case "active":
    case "grace":
      return end ? graceEndsAt(end) : null;
  }
}

function subscriptionView(sub: NonNullable<SubscriptionRow>, now: Date) {
  const end = sub.currentPeriodEnd;
  return {
    plan: sub.plan,
    billingPeriod: sub.billingPeriod,
    status: sub.status,
    /** نسخة الصف — يرسلها المدير مع أي تعديل (expectedVersion)، ونسخة قديمة تُرفض بـ409 (P9) */
    version: sub.version,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: end,
    legacyOpenEnded: sub.legacyOpenEnded,
    readOnlyFrom: readOnlyFrom(sub, now),
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
export const COMPANY_LIST_DEFAULT_PAGE_SIZE = 50;
export const COMPANY_LIST_MAX_PAGE_SIZE = 200;

/**
 * نظرة الشركات (§9) صفحةً صفحة (مراجعة #164): عدد الاستعلامات ثابت مهما كثرت الشركات في الصفحة أو المالكون — عدّ الصفحة، والصفحة
 * نفسها، ثم المقاعد المشغولة لكل الصفحة باستعلام مجمَّع واحد (بالمستأجر ونطاق العضوية)، والترتيب الحي لكل مالكي الصفحة بثلاثة
 * استعلامات (rankCompaniesByOwnerIdentities). القيم مطابقة لـ occupiedUserSeats وrankOwnerCompanies لكل شركة — الاختبار يقارنهما.
 * الترتيب ثابت (اسم المستأجر، تاريخ الإنشاء، المعرّف) فلا تتكرر شركة بين صفحتين ولا تسقط.
 */
export async function listCompanySubscriptions(
  filter: { tenantId?: string; status?: CompanySubscriptionStatus | "none"; q?: string; page?: number; pageSize?: number } = {},
  now: Date = new Date(),
) {
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const pageSize = Math.min(COMPANY_LIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(filter.pageSize ?? COMPANY_LIST_DEFAULT_PAGE_SIZE)));
  const where: Prisma.CompanyWhereInput = {
    ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
    ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { tenant: { name: { contains: filter.q, mode: "insensitive" } } }] } : {}),
    ...(filter.status === "none" ? { subscription: null } : filter.status ? { subscription: { status: filter.status } } : {}),
  };
  const [total, companies] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        businessActivity: true,
        createdAt: true,
        tenant: { select: { id: true, code: true, name: true, ownerId: true, subscriptionStatus: true, subscriptionPlan: true, trialEndsAt: true } },
        subscription: true,
        _count: { select: { posUsers: true } },
      },
      orderBy: [{ tenant: { name: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const tenantIds = [...new Set(companies.map((c) => c.tenant.id))];
  const ownerIds = [...new Set(companies.map((c) => c.tenant.ownerId).filter((id): id is string => !!id))];
  const [seatGroups, owners] = await Promise.all([
    // نفس شرط occupiedUserSeats: عضويات فعّالة غير محذوفة، نطاقها "all" (تُعدّ في كل شركات المستأجر) أو الشركة نفسها
    tenantIds.length
      ? prisma.user.groupBy({ by: ["tenantId", "companyScope"], where: { tenantId: { in: tenantIds }, active: true, deletedAt: null }, _count: { _all: true } })
      : [],
    ownerIds.length ? prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, identityId: true, identity: { select: { email: true } } } }) : [],
  ]);
  const seats = new Map(seatGroups.map((g) => [`${g.tenantId}:${g.companyScope}`, g._count._all]));
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const rankByCompany = await rankCompaniesByOwnerIdentities([...new Set(owners.map((o) => o.identityId))], now);

  const items = companies.map((c) => {
    const owner = c.tenant.ownerId ? ownerById.get(c.tenant.ownerId) : undefined;
    const occupied = (seats.get(`${c.tenant.id}:all`) ?? 0) + (seats.get(`${c.tenant.id}:${c.id}`) ?? 0);
    const sub = c.subscription;
    const limit = sub ? userLimit(sub.plan, sub.extraUsers) : null;
    return {
      companyId: c.id,
      companyName: c.name,
      businessActivity: c.businessActivity,
      tenant: { id: c.tenant.id, code: c.tenant.code, name: c.tenant.name, legacyStatus: c.tenant.subscriptionStatus, legacyPlan: c.tenant.subscriptionPlan, legacyTrialEndsAt: c.tenant.trialEndsAt },
      ownerEmail: owner?.identity.email ?? null,
      liveRank: rankByCompany.get(c.id) ?? null,
      subscription: sub ? subscriptionView(sub, now) : null,
      users: { occupied, limit, overLimit: limit !== null && occupied > limit },
      pos: { assigned: c._count.posUsers, capacity: sub ? posSeatCapacity(sub) : null },
    };
  });
  return { items, page, pageSize, total };
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
      where: posEligibleMemberWhere(company.tenantId, companyId),
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
export async function setCompanySubscriptionStatus(companyId: string, action: "suspend" | "activate", reason?: string, expectedVersion?: number) {
  // انتقال لا استبدال: محروس بحالته (claim على status في خدمة الدورة). النسخة اختيارية هنا — لوحة المدير ترسلها فلا يُعلَّق صفٌّ تغيّر
  // منذ فتحه دون أن يراه المدير
  if (expectedVersion !== undefined) {
    const current = await prisma.companySubscription.findUnique({ where: { companyId } });
    if (!current) throw notFound("لا يوجد اشتراك لهذه الشركة");
    assertExpectedVersion(current, expectedVersion);
  }
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
  /** نسخة الصف التي حمّلها المدير (P9) — غيابها (نداء داخلي) = بلا فحص */
  expectedVersion?: number;
};

/**
 * كميات الإضافات وحالتها (§9). لا تُنقَص سعة نقطة البيع تحت عدد المعيَّنين فعلاً (يُزال التعيين أولاً)، ولا مقاعد إضافية بلا تفعيل
 * نقطة البيع (D27). إنقاص المستخدمين الإضافيين لا يُخرج أحداً (§5.3)؛ تُظهره القائمة "متجاوزاً للحد" فقط.
 */
export async function updateCompanySubscriptionAddons(companyId: string, patch: AddonsPatch) {
  const result = await prisma.$transaction(async (tx) => {
    // تحت قفل مقاعد الشركة نفسه الذي يأخذه setCompanyPosUsers (مراجعة #163/#164): إنقاص السعة وتعيين المستخدمين لا يمرّان معاً
    await lockCompanyPosSeats(tx, companyId);
    const sub = await tx.companySubscription.findUnique({ where: { companyId } });
    if (!sub) throw notFound("لا يوجد اشتراك لهذه الشركة");
    assertExpectedVersion(sub, patch.expectedVersion);
    const next = {
      extraUsers: patch.extraUsers ?? sub.extraUsers,
      posEnabled: patch.posEnabled ?? sub.posEnabled,
      posUsers: patch.posUsers ?? (patch.posEnabled === false ? 0 : sub.posUsers),
      stationsAddon: patch.stationsAddon ?? sub.stationsAddon,
      stablesAddon: patch.stablesAddon ?? sub.stablesAddon,
    };
    await assertPosCapacityHolds(tx, companyId, next);
    const claim = await tx.companySubscription.updateMany({ where: { companyId, version: sub.version }, data: next });
    if (claim.count === 0) throw versionConflict(await tx.companySubscription.findUnique({ where: { companyId } }));
    const updated = await tx.companySubscription.findUniqueOrThrow({ where: { companyId } });
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
  // الشرط نفسه في الخدمة، لا في مخطط الطلب وحده: لا سعر null لبند مدفوع من أي مستدعٍ (مراجعة #164)
  if (input.yearlyNetPrice === null && !NULLABLE_PRICE_ITEMS.has(input.item)) throw badRequest(PRICE_REQUIRED_MESSAGE);
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
