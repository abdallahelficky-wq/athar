import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD");

export const createStatementSchema = z
  .object({
    companyId: z.string().min(1),
    accountId: z.string().min(1),
    periodStart: day,
    periodEnd: day,
    openingBalance: z.coerce.number(),
    closingBalance: z.coerce.number(),
    fileName: z.string().max(255).optional().nullable(),
    lines: z
      .array(
        z.object({
          date: day,
          description: z.string().max(1000).optional().nullable(),
          reference: z.string().max(255).optional().nullable(),
          amount: z.coerce.number(),
        }),
      )
      .min(1, "الكشف بلا أسطر")
      .max(20000),
  })
  .strict();

export const matchLineSchema = z.object({ journalEntryLineId: z.string().min(1) }).strict();
