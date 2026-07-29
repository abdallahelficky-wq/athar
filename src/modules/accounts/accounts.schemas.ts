import { z } from "zod";

export const createAccountSchema = z.object({
  name: z.string().min(2, "اسم الحساب قصير جداً"),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  companyId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  code: z.string().regex(/^\d{1,8}$/, "كود الحساب يجب أن يكون رقمياً وبحد أقصى 8 خانات"),
  level: z.number().int().min(1).max(4),
  isPosting: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isBankOrCash: z.boolean().optional(),
});

export const updateAccountSchema = createAccountSchema.partial();
