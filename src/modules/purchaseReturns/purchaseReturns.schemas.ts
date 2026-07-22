import { z } from "zod";

const lineSchema = z.object({
  accountId: z.string().min(1),
  description: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  priceIncludesVat: z.boolean().default(false),
});

export const createPurchaseReturnSchema = z.object({
  companyId: z.string().min(1),
  supplierId: z.string().min(1),
  relatedInvoiceId: z.string().optional(),
  date: z.coerce.date(),
  reason: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

export const unpostSchema = z.object({ pin: z.string().min(1) });
