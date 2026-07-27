import { z } from "zod";

export const createLeaseContractSchema = z.object({
  companyId: z.string(),
  title: z.string().min(2, "اسم/عنوان عقد الإيجار قصير جداً"),
  counterparty: z.string().nullable().optional(),
  monthlyRent: z.number().nonnegative().nullable().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  notes: z.string().nullable().optional(),
});

export const updateLeaseContractSchema = createLeaseContractSchema.partial();
