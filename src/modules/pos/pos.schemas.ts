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
  // المستودع المرتبط بجهاز نقطة البيع هذا (يُحفَظ محلياً على كل جهاز) — اختياري هنا فقط لأن
  // الشركات ذات المستودع الواحد تُحل تلقائياً بلا اختيار؛ التحقق الفعلي في pos.service.ts.
  warehouseId: z.string().optional(),
});
