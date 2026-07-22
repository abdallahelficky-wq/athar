import { z } from "zod";

export const createItemSchema = z.object({
  companyId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(2, "اسم الصنف قصير جداً"),
  unit: z.string().optional(),
  category: z.string().optional(),
  costPrice: z.coerce.number().min(0).default(0),
  reorderLevel: z.coerce.number().min(0).optional(),
});

export const updateItemSchema = createItemSchema.partial();
