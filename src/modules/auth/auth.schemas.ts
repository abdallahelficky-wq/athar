import { z } from "zod";

export const registerSchema = z.object({
  tenantName: z.string().min(2, "اسم المستأجر قصير جداً"),
  businessActivity: z.enum(["contracting", "manufacturing", "retail", "general_trade", "fuel_stations", "horse_stables"]),
  name: z.string().min(2, "الاسم قصير جداً"),
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
});

export const loginSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

export const completeLoginChoiceSchema = z.object({
  identityToken: z.string().min(1, "رمز اختيار الحساب مطلوب"),
  userId: z.string().min(1, "معرّف الحساب المطلوب تسجيل الدخول إليه مطلوب"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "رمز التحديث مطلوب"),
});

export const inviteSchema = z.object({
  name: z.string().min(2, "الاسم قصير جداً"),
  email: z.string().email("بريد إلكتروني غير صالح"),
  role: z.enum(["admin", "finance_manager", "accountant", "hr_manager", "viewer"]),
  companyScope: z.string().min(1).default("all"),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "رمز الدعوة مطلوب"),
  // اختيارية: مطلوبة فقط لو كانت هذه أول مرة تُحدَّد فيها كلمة مرور لهذه الهوية (تُتحقَّق فعلياً في
  // acceptInvite بخدمة auth.service.ts) — لو كانت الهوية موجودة بالفعل بكلمة مرور من عضوية أخرى،
  // فهذه الدعوة مجرد تأكيد انضمام لشركة إضافية بلا كلمة مرور جديدة.
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").optional(),
});

export const changeUnlockPinSchema = z.object({
  currentPin: z.string().min(1, "الرقم السري الحالي مطلوب"),
  newPin: z.string().min(4, "الرقم السري الجديد يجب أن يكون 4 أرقام على الأقل"),
});

export const updateTenantSchema = z.object({
  name: z.string().min(2, "اسم المنشأة قصير جداً"),
});

export const updateMeSchema = z.object({
  name: z.string().min(2, "الاسم قصير جداً"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "رمز إعادة التعيين مطلوب"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
});

export const setUserActiveSchema = z.object({
  active: z.boolean(),
});
