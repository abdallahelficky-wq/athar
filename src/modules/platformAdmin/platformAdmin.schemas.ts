import { z } from "zod";
import { PLATFORM_MODULE_IDS } from "../../lib/platformModules";

/**
 * يوم تقويمي حقيقي (مراجعة #164): JavaScript يطبّع 2027-02-30 إلى 2 مارس و2027-04-31 إلى 1 مايو بلا خطأ، فتخزَّن قيمة غير التي
 * أرسلها المدير. أي نص يبدأ بـYYYY-MM-DD يُرفَض إن لم يكن ذلك اليوم موجوداً (شهر 13، 30 فبراير، 29 فبراير في سنة غير كبيسة).
 */
const INVALID_DAY = "التاريخ غير موجود في التقويم";
const ISO_DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
export function isRealCalendarDay(value: string): boolean {
  const m = ISO_DAY_PREFIX.exec(value);
  if (!m) return true; // ليس بصيغة YYYY-MM-DD — يحكم عليه محوّل التاريخ نفسه
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
}
/** z.coerce.date() بلا تطبيع صامت لأيام غير موجودة */
const calendarDate = z
  .unknown()
  .superRefine((v, ctx) => {
    if (typeof v === "string" && !isRealCalendarDay(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: INVALID_DAY });
  })
  .pipe(z.coerce.date());
/** يوم بصيغة YYYY-MM-DD موجود في التقويم */
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD").refine(isRealCalendarDay, INVALID_DAY);

export const updateSubscriptionSchema = z.object({
  subscriptionStatus: z.enum(["trialing", "active", "past_due", "canceled", "suspended"]).optional(),
  subscriptionPlan: z.enum(["basic", "professional", "enterprise"]).optional(),
  // تاريخ حر بلا أي قيد مسبق — يسمح بتمديد يوم أو شهر أو سنة أو 10 سنوات كما طُلب صراحة
  trialEndsAt: calendarDate.nullable().optional(),
  suspensionReason: z.string().max(500).nullable().optional(),
});

export const updateModulesSchema = z.object({
  enabledModules: z.array(z.enum(PLATFORM_MODULE_IDS)),
});

export const createNoticeSchema = z.object({
  message: z.string().trim().min(1, "نص الإشعار مطلوب").max(2000),
});

export const updateAdminEmailSchema = z.object({
  adminEmail: z.string().trim().toLowerCase().email("صيغة البريد الإلكتروني غير صحيحة"),
});

// الإنفاذ (P4): المفتاح الشامل، وصف اشتراك شركة بتاريخ نهاية حقيقي، ومستخدمو نقطة البيع
export const enforcementSwitchSchema = z.object({ enabled: z.boolean() });

export const companySubscriptionSchema = z
  .object({
    plan: z.enum(["basic", "professional", "enterprise"]),
    billingPeriod: z.enum(["yearly", "monthly"]),
    status: z.enum(["trialing", "awaiting_payment", "active", "grace", "expired", "suspended", "canceled"]),
    currentPeriodStart: calendarDate,
    currentPeriodEnd: calendarDate,
    enforced: z.boolean(),
    posEnabled: z.boolean().optional(),
    posUsers: z.number().int().min(0).optional(),
    extraUsers: z.number().int().min(0).optional(),
    stationsAddon: z.enum(["off", "free", "paid"]).optional(),
    stablesAddon: z.enum(["off", "free", "paid"]).optional(),
  })
  .refine((v) => v.currentPeriodEnd > v.currentPeriodStart, { message: "تاريخ نهاية الاشتراك يجب أن يكون بعد بدايته", path: ["currentPeriodEnd"] });

export const companyPosUsersSchema = z.object({ userIds: z.array(z.string().min(1)).max(500) });

// P8: بقية واجهة لوحة مدير المنصة للاشتراكات (عدا الفوترة P7)
export const companySubscriptionStatusSchema = z
  .object({ action: z.enum(["suspend", "activate"]), reason: z.string().trim().max(500).optional() })
  .refine((v) => v.action !== "suspend" || (v.reason && v.reason.length > 0), { message: "سبب التعليق مطلوب", path: ["reason"] });

export const companySubscriptionAddonsSchema = z
  .object({
    extraUsers: z.number().int().min(0).max(1000).optional(),
    posEnabled: z.boolean().optional(),
    posUsers: z.number().int().min(0).max(1000).optional(),
    stationsAddon: z.enum(["off", "free", "paid"]).optional(),
    stablesAddon: z.enum(["off", "free", "paid"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "لا يوجد تغيير في الطلب" });

export const companySubscriptionsQuerySchema = z.object({
  tenantId: z.string().min(1).optional(),
  status: z.enum(["trialing", "awaiting_payment", "active", "grace", "expired", "suspended", "canceled", "none"]).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

/** البنود التي يجوز أن تكون بلا سعر (null): إضافتا النشاط فقط (D30) — مراجعة #164 */
export const NULLABLE_PRICE_ITEMS: ReadonlySet<string> = new Set(["addon_stations", "addon_stables"]);
export const PRICE_REQUIRED_MESSAGE = "هذا البند يحتاج سعراً — (بلا سعر) مسموح لإضافتَي المحطات والإسطبلات فقط";

export const schedulePlanPriceSchema = z
  .object({
    item: z.enum(["plan_basic", "plan_professional", "plan_enterprise", "addon_user", "addon_pos_extra_user", "addon_stations", "addon_stables"]),
    // null = بلا سعر (مجانية) — لإضافتَي النشاط وحدهما (المحطات والإسطبلات، D30)؛ الباقات والمستخدم الإضافي ومقعد نقطة البيع لها سعر دائماً
    yearlyNetPrice: z.number().min(0).max(1_000_000).multipleOf(0.01).nullable(),
    effectiveFrom: calendarDay,
  })
  .refine((v) => v.yearlyNetPrice !== null || NULLABLE_PRICE_ITEMS.has(v.item), {
    path: ["yearlyNetPrice"],
    message: PRICE_REQUIRED_MESSAGE,
  });
