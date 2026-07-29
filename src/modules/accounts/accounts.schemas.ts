import { z } from "zod";

export const createAccountSchema = z.object({
  name: z.string().min(2, "اسم الحساب قصير جداً"),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  companyId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  code: z.string().regex(/^\d{1,9}$/, "كود الحساب يجب أن يكون رقمياً وبحد أقصى 9 خانات"),
  level: z.number().int().min(1).max(6),
  isPosting: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isBankOrCash: z.boolean().optional(),
});

export const updateAccountSchema = createAccountSchema.partial();


const importAccountRowSchema = z.object({
  code: z.string().regex(/^\\d{1,9}$/, "كود الحساب يجب أن يكون رقمياً وبحد أقصى 9 خانات"),
  name: z.string().min(2, "اسم الحساب قصير جداً"),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  level: z.number().int().min(1).max(6),
  isPosting: z.boolean(),
  parentCode: z.string().regex(/^\\d{1,9}$/).nullable().optional(),
  isBankOrCash: z.boolean().optional(),
});

export const importAccountsSchema = z.object({
  companyId: z.string().nullable().optional(),
  rows: z.array(importAccountRowSchema).min(1, "ملف الاستيراد فارغ").max(2000, "الحد الأقصى 2000 حساب في العملية الواحدة"),
});
