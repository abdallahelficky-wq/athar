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
