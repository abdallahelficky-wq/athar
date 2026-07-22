import { z } from "zod";

export const createFixedAssetSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "اسم الأصل قصير جداً"),
  category: z.string().optional(),
  purchaseDate: z.coerce.date(),
  cost: z.coerce.number().positive(),
  usefulLifeYears: z.coerce.number().int().positive(),
  salvageValue: z.coerce.number().min(0).default(0),
  paymentMethod: z.enum(["cash", "bank", "credit"]).default("cash"),
});

export const updateFixedAssetSchema = z.object({
  name: z.string().min(2).optional(),
  category: z.string().optional(),
  usefulLifeYears: z.coerce.number().int().positive().optional(),
  salvageValue: z.coerce.number().min(0).optional(),
});

export const disposeFixedAssetSchema = z.object({
  disposalDate: z.coerce.date(),
  salePrice: z.coerce.number().min(0).default(0),
  method: z.enum(["cash", "bank"]).default("cash"),
});

export const removeSchema = z.object({ pin: z.string().min(1) });
