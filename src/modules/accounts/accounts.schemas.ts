import { z } from "zod";

export const createAccountSchema = z.object({
  name: z.string().min(2, "اسم الحساب قصير جداً"),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  isActive: z.boolean().optional(),
});

export const updateAccountSchema = createAccountSchema.partial();
