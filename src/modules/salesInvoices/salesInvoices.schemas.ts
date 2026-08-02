import { z } from "zod";

const lineSchema = z.object({
  accountId: z.string().min(1),
  // سلسلة فارغة (لا يوجد صنف مختار من الكتالوج — وصف حر) تُعامَل كغياب القيمة، حتى لا تُرسَل
  // كمعرّف علاقة فارغ ينتهك قيد المفتاح الأجنبي عند الحفظ في قاعدة البيانات
  itemId: z.string().optional().transform((v) => (v ? v : undefined)),
  description: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  priceIncludesVat: z.boolean().default(true),
  vatApplicable: z.boolean().default(true),
});

export const createSalesInvoiceSchema = z.object({
  companyId: z.string().min(1),
  customerId: z.string().min(1),
  date: z.coerce.date(),
  lines: z.array(lineSchema).min(1),
  post: z.boolean().default(true),
});

export const updateSalesInvoiceSchema = createSalesInvoiceSchema;

export const unpostSchema = z.object({ pin: z.string().min(1) });
