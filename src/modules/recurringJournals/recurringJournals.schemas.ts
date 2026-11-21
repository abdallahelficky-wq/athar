import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD");

export const templateSchema = z
  .object({
    companyId: z.string().min(1),
    name: z.string().trim().min(2, "اسم القيد الدوري قصير جداً").max(200),
    memo: z.string().max(1000).optional().nullable(),
    frequency: z.enum(["monthly", "quarterly", "semiannual", "yearly"]),
    dayOfMonth: z.coerce.number().int().refine((d) => (d >= 1 && d <= 28) || d === 31, "يوم الاستحقاق من 1 إلى 28 أو آخر الشهر"),
    startDate: day,
    endDate: day.optional().nullable(),
    autoPost: z.boolean().default(true),
    lines: z
      .array(
        z.object({
          accountId: z.string().min(1),
          costCenterId: z.string().optional().nullable(),
          description: z.string().max(500).optional().nullable(),
          debit: z.coerce.number().default(0),
          credit: z.coerce.number().default(0),
        }),
      )
      .min(2, "القيد يجب أن يحتوي على سطرين على الأقل")
      .max(200),
  })
  .strict();

export const activeSchema = z.object({ active: z.boolean() }).strict();
