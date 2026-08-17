import { z } from "zod";

function rejectDuplicateAccounts<T extends { assetAccountId?: string; accumulatedDepreciationAccountId?: string; depreciationExpenseAccountId?: string }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  const ids = [data.assetAccountId, data.accumulatedDepreciationAccountId, data.depreciationExpenseAccountId].filter(Boolean);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "لا يمكن استخدام نفس الحساب لأكثر من دور ضمن نفس الفئة" });
  }
}

export const createAssetCategorySchema = z
  .object({
    companyId: z.string().min(1),
    groupName: z.string().min(1, "اسم المجموعة مطلوب"),
    name: z.string().min(1, "اسم الفئة مطلوب"),
    assetAccountId: z.string().min(1, "اختر حساب اقتناء الأصل"),
    accumulatedDepreciationAccountId: z.string().min(1, "اختر حساب مجمع الإهلاك"),
    depreciationExpenseAccountId: z.string().min(1, "اختر حساب مصروف الإهلاك"),
  })
  .superRefine(rejectDuplicateAccounts);

export const updateAssetCategorySchema = z
  .object({
    groupName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    assetAccountId: z.string().min(1).optional(),
    accumulatedDepreciationAccountId: z.string().min(1).optional(),
    depreciationExpenseAccountId: z.string().min(1).optional(),
  })
  .superRefine(rejectDuplicateAccounts);
