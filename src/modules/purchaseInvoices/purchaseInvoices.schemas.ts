import { z } from "zod";

const lineSchema = z.object({
  // إلزامي دائماً كـ fallback: لو السطر مرتبط بصنف (itemId) يُشتق الحساب تلقائياً من نوعه
  // عند الترحيل ويتجاهل الخادم أي قيمة هنا؛ يبقى مطلوباً للأسطر الحرة (مصاريف متفرقة بلا صنف).
  accountId: z.string().min(1),
  itemId: z.string().optional(),
  warehouseId: z.string().optional(),
  // فقط لو الصنف من نوع "أصل ثابت"
  usefulLifeYears: z.coerce.number().positive().optional(),
  salvageValue: z.coerce.number().min(0).optional(),
  description: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  priceIncludesVat: z.boolean().default(false),
});

export const createPurchaseInvoiceSchema = z.object({
  companyId: z.string().min(1),
  supplierId: z.string().min(1),
  date: z.coerce.date(),
  lines: z.array(lineSchema).min(1),
});

export const updatePurchaseInvoiceSchema = createPurchaseInvoiceSchema;

export const unpostSchema = z.object({ pin: z.string().min(1) });
