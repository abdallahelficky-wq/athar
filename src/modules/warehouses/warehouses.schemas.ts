import { z } from "zod";

export const createWarehouseSchema = z.object({
  companyId: z.string(),
  name: z.string().min(2, "اسم المستودع قصير جداً"),
  code: z.string().optional(),
  location: z.string().optional(),
  isDefault: z.boolean().optional(),
  // حساب مخزون المستودع (اختياري في الواجهة البرمجية: null = حساب الصنف؛ شاشة المستودعات تطلبه عند الإضافة)
  stockAccountId: z.string().min(1).nullable().optional(),
});

export const updateWarehouseSchema = createWarehouseSchema.partial().omit({ companyId: true }).extend({
  isArchived: z.boolean().optional(),
});
