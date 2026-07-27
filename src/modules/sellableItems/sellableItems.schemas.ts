import { z } from "zod";

export const createSellableItemSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "اسم الصنف قصير جداً"),
  defaultUnitPrice: z.coerce.number().min(0).default(0),
  vatApplicable: z.boolean().default(true),
  defaultRevenueAccountId: z.string().min(1, "الحساب المرتبط مطلوب"),
});

export const updateSellableItemSchema = createSellableItemSchema.partial();
