import { z } from "zod";
import { salesInvoiceLineSchema } from "../salesInvoices/salesInvoices.schemas";

export const posPaymentSchema = z.object({
  method: z.enum(["cash", "bank"]),
  amount: z.coerce.number().positive(),
  bankAccountId: z.string().optional(),
});

export const createPosSaleSchema = z.object({
  companyId: z.string().min(1),
  // اختياري — لو غاب يُستخدَم "عميل نقدي" المزروع تلقائياً لكل شركة جديدة (starterData.ts)
  customerId: z.string().optional(),
  date: z.coerce.date().default(() => new Date()),
  lines: z.array(salesInvoiceLineSchema).min(1),
  payments: z.array(posPaymentSchema).min(1),
});
