import { z } from "zod";

export const createWarehouseSchema = z.object({
  companyId: z.string(),
  name: z.string().min(2, "اسم المستودع قصير جداً"),
  code: z.string().optional(),
  location: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const updateWarehouseSchema = createWarehouseSchema.partial().omit({ companyId: true }).extend({
  isArchived: z.boolean().optional(),
});
