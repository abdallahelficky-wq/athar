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
