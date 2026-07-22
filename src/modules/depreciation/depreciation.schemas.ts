import { z } from "zod";

export const createDepreciationRunSchema = z.object({
  companyId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "صيغة الشهر يجب أن تكون YYYY-MM"),
});

export const removeSchema = z.object({ pin: z.string().min(1) });
