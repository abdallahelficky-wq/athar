import type { ActivityAddonState, BusinessActivity, BillingPeriod, CompanySubscriptionStatus, Prisma, SubscriptionPlan } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./httpError";
import { readOnlyAt } from "./subscriptionLifecycle";
import { companyEntitlements, type CompanyEntitlements, posUserLimit, userLimit } from "./subscriptionPlans";

/**
 * الإنفاذ على الخادم (P4، docs/design/subscription-plans.md §5). القاعدة الحاكمة: لا يُنفَّذ شيء على شركة إلا حين يكون مفتاح المنصة
 * الشامل subscription_enforcement مفعّلاً **و** صفّ اشتراكها enforced=true. غير ذلك (المفتاح معطّل — وهو الافتراضي — أو لا صف، أو
 * صف غير مفعّل) يبقى سلوك اليوم بالضبط، بما فيه "عرض فقط" على مستوى المستأجر (D31، D32).
 *
 * القراءات (عرض، تقارير، طباعة، تصدير) لا تُمنَع أبداً بسبب الباقة — الوحدة خارج الباقة تُمنَع كتابتها فقط (D31).
 * الحالة مخزَّنة 30 ثانية لكل عملية خادم؛ أي كتابة من هذه العملية تفرغها فوراً، والنسخ الأخرى تلحق خلال 30 ثانية.
 */

const TTL_MS = 30_000;
export const ENFORCEMENT_SETTING_KEY = "subscription_enforcement";

export const MESSAGES = {
  readOnly: "هذه الشركة في وضع (عرض فقط) لانتهاء اشتراكها — يمكنك الاطلاع على بياناتها وتصديرها، وللإضافة أو التعديل أو الحذف جدّد الاشتراك.",
  suspended: "اشتراك هذه الشركة معلّق — يمكنك الاطلاع على بياناتها، وللإضافة أو التعديل تواصل مع الدعم الفني.",
  planModule: "هذه الميزة غير مشمولة في باقة الشركة الحالية — يمكنك الاطلاع على بياناتها الحالية وتصديرها، وللإضافة أو التعديل يمكنك ترقية الباقة.",
  posSeat: "لست معيَّناً مستخدماً لنقطة البيع في هذه الشركة — اطلب من مالك الشركة تعيينك قبل فتح مبيعات نقطة البيع.",
  userLimit: "بلغت الشركة حد المستخدمين في باقتها — أضف مستخدمين إضافيين أو رقِّ الباقة قبل دعوة مستخدم جديد أو تفعيله.",
  posSeatsFull: "لا توجد مقاعد نقطة بيع متاحة لهذه الشركة — أضف مقاعد إضافية قبل تعيين مستخدم جديد.",
  posDisabled: "نقطة البيع غير مفعّلة لهذه الشركة.",
  stationWorkersOnly: "باقة الشركة الحالية تشمل سجلات عمّال المحطات فقط — حدّد محطة الموظف، أو رقِّ الباقة لإدارة كل الموظفين.",
} as const;

export type EnforcedCompany = {
  companyId: string;
  tenantId: string;
  plan: SubscriptionPlan;
  billingPeriod: BillingPeriod;
  status: CompanySubscriptionStatus;
  currentPeriodEnd: Date | null;
  extraUsers: number;
  posEnabled: boolean;
  posUsers: number;
  stationsAddon: ActivityAddonState;
  stablesAddon: ActivityAddonState;
  businessActivity: BusinessActivity | null;
  entitlements: CompanyEntitlements;
};

let globalCache: { value: boolean; at: number } | null = null;
const companyCache = new Map<string, { value: EnforcedCompany | null; at: number }>();
const tenantCache = new Map<string, { value: boolean; at: number }>();

export function clearSubscriptionEnforcementCache() {
  globalCache = null;
  companyCache.clear();
  tenantCache.clear();
}

const fresh = (entry: { at: number } | null | undefined) => !!entry && Date.now() - entry.at < TTL_MS;

/** المفتاح الشامل — صف غائب أو قيمة غير true = معطّل (افتراضياً) */
export async function isEnforcementEnabled(): Promise<boolean> {
  if (fresh(globalCache)) return globalCache!.value;
  let value: boolean;
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: ENFORCEMENT_SETTING_KEY } });
    value = row?.value === true;
  } catch {
    // تعذّرت قراءة المفتاح (قاعدة غير متاحة، أو عميل مُحاكى في اختبارات الوحدة بلا هذا الجدول): الافتراضي "معطّل" = سلوك اليوم.
    // لا يُخزَّن، فتُعاد المحاولة في الطلب التالي.
    return false;
  }
  globalCache = { value, at: Date.now() };
  return value;
}

/** هل للمستأجر أي شركة مُنفَّذة؟ — يجعل حارس الكتابة بلا كلفة لكل مستأجر لم تُفعَّل فيه أي شركة */
export async function tenantHasEnforcedCompany(tenantId: string): Promise<boolean> {
  if (!(await isEnforcementEnabled())) return false;
  const cached = tenantCache.get(tenantId);
  if (fresh(cached)) return cached!.value;
  const value = (await prisma.companySubscription.count({ where: { enforced: true, company: { tenantId } } })) > 0;
  tenantCache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** الشركة مُنفَّذة؟ null = سلوك اليوم (المفتاح معطّل، أو لا صف، أو enforced=false) */
export async function enforcedCompany(companyId: string): Promise<EnforcedCompany | null> {
  if (!(await isEnforcementEnabled())) return null;
  const cached = companyCache.get(companyId);
  if (fresh(cached)) return cached!.value;
  const row = await prisma.companySubscription.findUnique({
    where: { companyId },
    include: { company: { select: { tenantId: true, businessActivity: true } } },
  });
  const value: EnforcedCompany | null =
    row && row.enforced
      ? {
          companyId,
          tenantId: row.company.tenantId,
          plan: row.plan,
          billingPeriod: row.billingPeriod,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd,
          extraUsers: row.extraUsers,
          posEnabled: row.posEnabled,
          posUsers: row.posUsers,
          stationsAddon: row.stationsAddon,
          stablesAddon: row.stablesAddon,
          businessActivity: row.company.businessActivity,
          entitlements: companyEntitlements({ ...row, businessActivity: row.company.businessActivity }),
        }
      : null;
  companyCache.set(companyId, { value, at: Date.now() });
  return value;
}

const refuse = (message: string, code: string, extra: Record<string, unknown> = {}) => new HttpError(403, message, { code, ...extra });

/** الكتابة في شركة مُنفَّذة: ممنوعة إن كانت معلّقة أو "عرض فقط" بالتاريخ (§5.4) — المقارنة بالتاريخ نفسه، لا بانتظار المُجدوِل */
export function assertEnforcedCompanyWritable(company: EnforcedCompany, now: Date = new Date()) {
  if (company.status === "suspended") throw refuse(MESSAGES.suspended, "subscription_suspended", { companyId: company.companyId });
  if (readOnlyAt(company, now)) throw refuse(MESSAGES.readOnly, "subscription_read_only", { companyId: company.companyId });
}

/** كتابة في وحدة خارج الباقة — القراءة لا تمرّ من هنا أبداً (D31) */
export function assertEnforcedModuleWritable(company: EnforcedCompany, resourceId: string) {
  if (!company.entitlements.modules.has(resourceId)) {
    throw refuse(MESSAGES.planModule, "plan_module_not_included", { companyId: company.companyId, moduleId: resourceId, plan: company.plan });
  }
}

/** فتح مبيعات نقطة البيع: تعيين صريح للعضو في هذه الشركة، المالك نفسه ضمناً (D19) */
export async function assertPosSeat(company: EnforcedCompany, userId: string) {
  if (!company.posEnabled) throw refuse(MESSAGES.posDisabled, "pos_not_enabled", { companyId: company.companyId });
  const seat = await prisma.companyPosUser.findUnique({ where: { companyId_userId: { companyId: company.companyId, userId } } });
  if (!seat) throw refuse(MESSAGES.posSeat, "pos_seat_required", { companyId: company.companyId });
}

/** كل الفحوص لكتابة واحدة في شركة واحدة، بحسب ما سجّله الطلب من وحدات كتابة */
export async function assertRequestMayWrite(companyId: string, writeResources: Iterable<string>, now: Date = new Date()) {
  const company = await enforcedCompany(companyId);
  if (!company) return;
  assertEnforcedCompanyWritable(company, now);
  for (const resourceId of writeResources) assertEnforcedModuleWritable(company, resourceId);
}

/** المقاعد المشغولة: عضويات فعّالة غير محذوفة (مقبولة أو دعوة معلّقة) نطاقها "all" أو هذه الشركة — عضوية "all" تُعدّ في كل شركة */
export async function occupiedUserSeats(tenantId: string, companyId: string, excludeUserId?: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  return db.user.count({
    where: {
      tenantId,
      active: true,
      deletedAt: null,
      companyScope: { in: ["all", companyId] },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
  });
}

/**
 * حد المستخدمين (§5.3) مع الكتابة نفسها، ذرّياً: يُفحَص عند دعوة عضو، أو إعادة تفعيله، أو نقل نطاقه إلى شركة. لا يُخرج أحداً قائماً
 * ولا يمنع قبول دعوة صدرت سابقاً — يمنع الإضافة الجديدة فقط. نطاق "all" يشغل مقعداً في كل شركات المستأجر، فيُفحَص على كل شركة
 * مُنفَّذة منها.
 *
 * العدّ والكتابة في معاملة واحدة تحت قفل استشاري لكل شركة (pg_advisory_xact_lock، بترتيب المعرّفات فلا جمود بين طلبين): طلبان
 * متزامنان على آخر مقعد يتسلسلان، والثاني يعدّ بعد أن يُثبَّت الأول فيُرفَض. مستأجر بلا شركة مُنفَّذة: الكتابة كما هي اليوم بلا معاملة.
 */
export async function withUserSeat<T>(
  tenantId: string,
  scope: string,
  excludeUserId: string | undefined,
  write: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!(await tenantHasEnforcedCompany(tenantId))) return write(prisma);
  const companyIds = scope === "all" ? (await prisma.company.findMany({ where: { tenantId }, select: { id: true } })).map((c) => c.id) : [scope];
  const enforced = (await Promise.all(companyIds.map((id) => enforcedCompany(id)))).filter((c): c is EnforcedCompany => !!c && c.tenantId === tenantId);
  if (enforced.length === 0) return write(prisma);
  enforced.sort((a, b) => (a.companyId < b.companyId ? -1 : 1));
  return prisma.$transaction(async (tx) => {
    for (const company of enforced) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user_seats:${company.companyId}`}))`;
    for (const company of enforced) {
      const limit = userLimit(company.plan, company.extraUsers);
      if ((await occupiedUserSeats(tenantId, company.companyId, excludeUserId, tx)) + 1 > limit) {
        throw refuse(MESSAGES.userLimit, "user_limit_reached", { companyId: company.companyId, limit });
      }
    }
    return write(tx);
  });
}

/** حد مقاعد نقطة البيع (D27): 1 مجاني + المقاعد الإضافية، وصفر بلا تفعيل — للتعيين، لا لفتح البيع */
export function posSeatCapacity(company: { posEnabled: boolean; posUsers: number }): number {
  return posUserLimit(company.posEnabled, company.posUsers);
}

/** خطأ قاعدة عمّال المحطات (D20) — يرميه حارس الكتابة */
export function stationWorkersOnlyError(companyId: string) {
  return refuse(MESSAGES.stationWorkersOnly, "station_workers_only", { companyId });
}
