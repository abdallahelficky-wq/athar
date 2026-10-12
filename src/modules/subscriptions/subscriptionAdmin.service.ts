import type { ActivityAddonState, BillingPeriod, CompanySubscriptionStatus, Prisma, SubscriptionPlan } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { clearSubscriptionEnforcementCache, ENFORCEMENT_SETTING_KEY, MESSAGES, posSeatCapacity } from "../../lib/subscriptionEnforcement";

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

/** ينشئ صف اشتراك الشركة أو يحدّثه بتاريخ نهاية حقيقي (لا صف "قديم بلا نهاية" من هنا)، مع حدث بالقيم قبل وبعد */
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
    posEnabled: input.posEnabled ?? false,
    posUsers: input.posUsers ?? 0,
    extraUsers: input.extraUsers ?? 0,
    ...(input.stationsAddon ? { stationsAddon: input.stationsAddon } : {}),
    ...(input.stablesAddon ? { stablesAddon: input.stablesAddon } : {}),
    ownerIdentityId: owner?.identityId ?? null,
  };
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.companySubscription.findUnique({ where: { companyId } });
    const after = before
      ? await tx.companySubscription.update({ where: { companyId }, data })
      : await tx.companySubscription.create({ data: { companyId, ...data } });
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
