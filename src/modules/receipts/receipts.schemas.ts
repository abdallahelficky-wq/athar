import { z } from "zod";

export const createReceiptSchema = z.object({
  companyId: z.string().min(1),
  customerId: z.string().min(1),
  date: z.coerce.date(),
  method: z.enum(["cash", "bank"]),
  allocations: z
    .array(z.object({ invoiceId: z.string().min(1), amount: z.coerce.number().positive() }))
    .min(1, "يجب تخصيص السند لفاتورة واحدة على الأقل"),
});

export const unpostSchema = z.object({ pin: z.string().min(1) });
