import { z } from "zod";

export const generateCsrSchema = z.object({
  production: z.boolean().default(false),
  solutionName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  // "both" افتراضياً — الأكثر أماناً (يخوِّل كل أنواع الفواتير) لا أضيق احتياج ممكن. راجع
  // ZatcaCsrInvoiceType في schema.prisma.
  invoiceType: z.enum(["standard", "simplified", "both"]).default("both"),
});

export const complianceOtpSchema = z.object({
  otp: z.string().min(1),
});

export const setEnvironmentSchema = z.object({
  environment: z.enum(["sandbox", "simulation", "production"]),
});

// الربط بخطوة واحدة — راجع zatcaOneStepOnboarding.ts. otp اختياري هنا لأن الاستئناف (شهادة اختبار
// فعّالة موجودة) لا يحتاجه؛ إلزاميته في المسار الجديد تُفحَص داخل الخدمة.
export const oneStepOnboardingSchema = z.object({
  otp: z.string().trim().optional(),
  environment: z.enum(["sandbox", "simulation", "production"]).optional(),
});
