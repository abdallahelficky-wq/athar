import { z } from "zod";

const lineSchema = z.object({
  accountId: z.string().min(1),
  itemId: z.string().optional().transform((v) => (v ? v : undefined)),
  description: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  priceIncludesVat: z.boolean().default(true),
  vatApplicable: z.boolean().default(true),
});

export const createQuotationSchema = z.object({
  companyId: z.string().min(1),
  customerId: z.string().min(1),
  date: z.coerce.date(),
  validUntil: z.coerce.date().optional(),
  lines: z.array(lineSchema).min(1),
});

export const updateQuotationSchema = createQuotationSchema;
