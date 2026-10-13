import { z } from "zod";
import { PLATFORM_MODULE_IDS } from "../../lib/platformModules";

export const updateSubscriptionSchema = z.object({
  subscriptionStatus: z.enum(["trialing", "active", "past_due", "canceled", "suspended"]).optional(),
  subscriptionPlan: z.enum(["basic", "professional", "enterprise"]).optional(),
  // تاريخ حر بلا أي قيد مسبق — يسمح بتمديد يوم أو شهر أو سنة أو 10 سنوات كما طُلب صراحة
  trialEndsAt: z.coerce.date().nullable().optional(),
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
    currentPeriodStart: z.coerce.date(),
    currentPeriodEnd: z.coerce.date(),
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
});

export const schedulePlanPriceSchema = z.object({
  item: z.enum(["plan_basic", "plan_professional", "plan_enterprise", "addon_user", "addon_pos_extra_user", "addon_stations", "addon_stables"]),
  // null = بلا سعر (مجانية)، كإضافتَي المحطات والإسطبلات اليوم (D30)
  yearlyNetPrice: z.number().min(0).max(1_000_000).multipleOf(0.01).nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD"),
});
