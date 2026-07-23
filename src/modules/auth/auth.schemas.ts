import { z } from "zod";

export const registerSchema = z.object({
  tenantName: z.string().min(2, "اسم المستأجر قصير جداً"),
  name: z.string().min(2, "الاسم قصير جداً"),
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
});

export const loginSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
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
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
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
