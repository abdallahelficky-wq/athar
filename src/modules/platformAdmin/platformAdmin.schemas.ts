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
