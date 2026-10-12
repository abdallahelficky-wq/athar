import type { BillingPeriod, SubscriptionPlan } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { type AddOnSelection, type PlanPriceTable, quoteCompany } from "../../lib/subscriptionPricing";

/**
 * عرض سعر الاشتراك من الخادم (docs/design/subscription-plans.md §4 و§7) — الواجهة لا تعيد حساب الأسعار أبداً. يقرأ الأسعار
 * السارية من plan_prices وترتيب الشركة الجديدة بين شركات هوية المالك "الحيّة". لا مسار يستدعيه بعد (المرحلة P2)؛ التسجيل
 * (P5) وإضافة شركة (P6) سيستدعيانه.
 */

const PRICE_ITEMS: (keyof PlanPriceTable)[] = ["plan_basic", "plan_professional", "plan_enterprise", "addon_user", "addon_pos_extra_user", "addon_stations", "addon_stables"];
const RANK_KEEP_DAYS = 30; // D21
const DAY_MS = 86_400_000;

/** الأسعار السارية في اليوم السعودي للحظة `at`: لكل بند أحدث صف effectiveFrom <= ذلك اليوم */
export async function planPricesAt(at: Date): Promise<PlanPriceTable & { effectiveOn: string }> {
  const day = riyadhCalendarDay(at);
  const rows = await prisma.planPrice.findMany({
    where: { effectiveFrom: { lte: new Date(`${day}T00:00:00.000Z`) } },
    orderBy: [{ effectiveFrom: "desc" }],
  });
  const table = {} as PlanPriceTable;
  for (const item of PRICE_ITEMS) {
    const row = rows.find((r) => r.item === item);
    if (!row) throw new Error(`لا سعر سارياً للبند ${item} في ${day}`);
    table[item] = row.yearlyNetPrice == null ? null : row.yearlyNetPrice.toNumber();
  }
  return { ...table, effectiveOn: day };
}

type RankedCompany = { companyId: string; tenantId: string; createdAt: Date; rank: number };

/**
 * شركات هوية المالك "الحيّة" مرتّبة (§4 Rank): عبر كل المستأجرات التي تملكها الهوية (tenants.ownerId ← users.identityId)،
 * بتاريخ إنشاء الشركة ثم المعرّف. الحيّة: trialing/awaiting_payment/active/grace، أو expired منذ 30 يوماً على الأكثر من بدء
 * العرض فقط (D21). بدء العرض فقط = آخر حدث expired، وبلا حدث = currentPeriodEnd؛ بلا أيّهما تبقى حيّة. شركة بلا صف اشتراك بعد
 * (قبل ترحيل P11) تُعدّ حيّة: هي قائمة ومستخدَمة اليوم.
 */
export async function rankOwnerCompanies(ownerIdentityId: string, at: Date = new Date()): Promise<RankedCompany[]> {
  const memberships = await prisma.user.findMany({ where: { identityId: ownerIdentityId }, select: { id: true } });
  if (memberships.length === 0) return [];
  const companies = await prisma.company.findMany({
    where: { tenant: { ownerId: { in: memberships.map((m) => m.id) } } },
    select: {
      id: true,
      tenantId: true,
      createdAt: true,
      subscription: {
        select: {
          status: true,
          currentPeriodEnd: true,
          events: { where: { type: "expired" }, orderBy: { at: "desc" }, take: 1, select: { at: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const live = companies.filter(({ subscription: sub }) => {
    if (!sub) return true;
    if (sub.status === "suspended" || sub.status === "canceled") return false;
    if (sub.status !== "expired") return true;
    const readOnlySince = sub.events[0]?.at ?? sub.currentPeriodEnd;
    return !readOnlySince || at.getTime() - readOnlySince.getTime() <= RANK_KEEP_DAYS * DAY_MS;
  });
  return live.map((c, i) => ({ companyId: c.id, tenantId: c.tenantId, createdAt: c.createdAt, rank: i + 1 }));
}

/**
 * سعر شركة جديدة لهوية المالك: ترتيبها = عدد شركاتها الحيّة + 1 (الأحدث دائماً)، وهوية بلا شركات (أو تسجيل جديد بلا هوية
 * بعد) = الترتيب 1 بالسعر الكامل.
 */
export async function previewSubscriptionPrice(
  ownerIdentityId: string | null,
  plan: SubscriptionPlan,
  period: BillingPeriod,
  addOns: AddOnSelection = {},
  at: Date = new Date(),
) {
  const prices = await planPricesAt(at);
  const rank = ownerIdentityId ? (await rankOwnerCompanies(ownerIdentityId, at)).length + 1 : 1;
  return { plan, period, pricesEffectiveOn: prices.effectiveOn, ...quoteCompany(prices, plan, period, rank, addOns) };
}
