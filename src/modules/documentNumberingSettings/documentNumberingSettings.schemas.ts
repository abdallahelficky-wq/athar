import { z } from "zod";

export const docTypeParamSchema = z.enum(["sales_invoice", "quotation", "sales_return"]);

export const updateDocumentNumberingSettingsSchema = z.object({
  // بادئة نصية حرة تدعم الرمز الخاص {year} (يُستبدَل بالسنة الميلادية الحالية عند كل توليد رقم)
  prefix: z.string().trim().min(1, "البادئة مطلوبة").max(30, "البادئة طويلة جداً"),
  digits: z.coerce.number().int().min(3, "3 أرقام على الأقل").max(10, "10 أرقام كحد أقصى"),
  resetMode: z.enum(["continuous", "annual"]),
});
