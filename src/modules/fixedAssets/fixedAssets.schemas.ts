import { z } from "zod";

// طريقة القسط الثابت هي الوحيدة المحسوبة فعلياً (src/lib/depreciation.ts) — المتناقص محفوظ في
// enum الـ schema (Prisma) تمهيداً لدعمه لاحقاً، لكن يُرفَض هنا صراحة برسالة واضحة بدل قبوله
// بصمت وحساب رقم خاطئ.
const depreciationMethodSchema = z.enum(["straight_line", "declining_balance"]).default("straight_line");

function rejectUnsupportedDepreciationMethod<T extends { depreciationMethod?: "straight_line" | "declining_balance" }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (data.depreciationMethod && data.depreciationMethod !== "straight_line") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["depreciationMethod"],
      message: "طريقة الإهلاك المتناقص غير محسوبة بعد — القسط الثابت هو المتاح حالياً.",
    });
  }
}

export const createFixedAssetSchema = z
  .object({
    companyId: z.string().min(1),
    accountId: z.string().min(1, "اختر الحساب المحاسبي الذي سيُسجَّل عليه هذا الأصل"),
    name: z.string().min(2, "اسم الأصل قصير جداً"),
    category: z.string().optional(),
    serialNumber: z.string().optional(),
    chassisNumber: z.string().optional(),
    costCenterId: z.string().optional(),
    purchaseDate: z.coerce.date(),
    cost: z.coerce.number().positive(),
    usefulLifeYears: z.coerce.number().int().positive(),
    salvageValue: z.coerce.number().min(0).default(0),
    depreciationMethod: depreciationMethodSchema,
    isDepreciable: z.coerce.boolean().default(true),
    paymentMethod: z.enum(["cash", "bank", "credit"]).default("cash"),
  })
  .superRefine(rejectUnsupportedDepreciationMethod);

export const updateFixedAssetSchema = z
  .object({
    accountId: z.string().min(1).optional(),
    name: z.string().min(2).optional(),
    category: z.string().optional(),
    serialNumber: z.string().optional(),
    chassisNumber: z.string().optional(),
    costCenterId: z.string().optional(),
    usefulLifeYears: z.coerce.number().int().positive().optional(),
    salvageValue: z.coerce.number().min(0).optional(),
    depreciationMethod: depreciationMethodSchema.optional(),
    isDepreciable: z.coerce.boolean().optional(),
  })
  .superRefine(rejectUnsupportedDepreciationMethod);

export const disposeFixedAssetSchema = z.object({
  disposalDate: z.coerce.date(),
  salePrice: z.coerce.number().min(0).default(0),
  method: z.enum(["cash", "bank"]).default("cash"),
});

export const removeSchema = z.object({ pin: z.string().min(1) });
