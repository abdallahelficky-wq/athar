import { z } from "zod";
import { COUNTRY_CODES, CURRENCY_CODES } from "../../lib/countries";

export const createBranchSchema = z.object({
  companyId: z.string().min(1, "الشركة مطلوبة"),
  nameAr: z.string().min(2, "اسم الفرع قصير جداً"),
  nameEn: z.string().nullable().optional(),
  country: z.enum(COUNTRY_CODES),
  currency: z.enum(CURRENCY_CODES),
  // سعر الصرف يدوي مقابل عملة الشركة الأم: مبلغ بعملة الشركة = مبلغ بعملة الفرع × هذا السعر.
  // اختياري — بدونه، القيمة المعادلة بعملة الفرع لا تُعرَض ببساطة (لا افتراض قيمة عشوائية).
  exchangeRateToCompanyCurrency: z.number().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateBranchSchema = createBranchSchema.partial();
