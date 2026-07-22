import { z } from "zod";

export const ACTION_TYPES = [
  "absence", "overtime", "bonus", "other_addition", "advance", "violation", "penalty", "other_deduction", "warning",
] as const;

export const createHrActionBatchSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1, "اختر موظفاً واحداً على الأقل"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "صيغة الشهر يجب أن تكون YYYY-MM"),
  actionType: z.enum(ACTION_TYPES),
  value: z.coerce.number().min(0).default(0),
  note: z.string().optional(),
});
