import { z } from "zod";

/**
 * عدد خانات العداد قبل الفاصلة العشرية — إلزامي لكل فوهة (لا قيمة افتراضية): هو ما يحدد نقطة اللفّة
 * في computeNozzleLiters. العدادات الميكانيكية 6–7 خانات عادةً والإلكترونية حتى 9–10.
 */
const meterDigits = z.coerce.number().int("عدد خانات العداد يجب أن يكون عدداً صحيحاً").min(4, "عدد خانات العداد 4 على الأقل").max(10, "عدد خانات العداد 10 على الأكثر");
const initialReading = z.coerce.number().min(0, "قراءة العداد لا تكون سالبة");

const nozzleSetupSchema = z.object({ meterDigits, initialReading }).strict();

// مضخة = فوهتان بالضبط: بنزين (91 + 95) أو ديزل (ديزل + ديزل) — لا تركيبات أخرى، ولا فوهة منفردة.
export const createPumpSchema = z
  .object({
    companyId: z.string().min(1),
    costCenterId: z.string().min(1, "اختر المحطة"),
    pumpType: z.enum(["petrol", "diesel"]),
    meterType: z.enum(["mechanical", "electronic"]),
    hasMoneyMeter: z.boolean().default(false),
    nozzles: z.tuple([nozzleSetupSchema, nozzleSetupSchema]),
  })
  .strict();

export const updateNozzleSchema = z
  .object({ meterDigits: meterDigits.optional(), initialReading: initialReading.optional(), meterType: z.enum(["mechanical", "electronic"]).optional() })
  .strict();

export const retirePumpSchema = z.object({ companyId: z.string().min(1), costCenterId: z.string().min(1), pumpNumber: z.coerce.number().int().positive() }).strict();

// سعر واحد لكل منتج بتاريخ سريان، يسري على كل محطات الشركة (أسعار الوقود في السعودية موحّدة وطنياً).
export const createFuelPriceSchema = z
  .object({
    companyId: z.string().min(1),
    product: z.enum(["gasoline_91", "gasoline_95", "diesel"]),
    priceInclVat: z.coerce.number().positive("السعر يجب أن يكون أكبر من صفر").max(100, "السعر غير معقول"),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ السريان مطلوب (YYYY-MM-DD)"),
  })
  .strict();
