import { z } from "zod";

export const budgetSchema = z
  .object({
    companyId: z.string().min(1),
    name: z.string().trim().min(2, "اسم الموازنة قصير جداً").max(200),
    startMonth: z.string().regex(/^\d{4}-\d{2}$/, "شهر بداية الموازنة غير صالح"),
    costCenterId: z.string().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    lines: z.array(z.object({ accountId: z.string().min(1), months: z.array(z.coerce.number()).length(12) })).max(2000),
  })
  .strict();

export const statusSchema = z.object({ status: z.enum(["draft", "approved"]) }).strict();
