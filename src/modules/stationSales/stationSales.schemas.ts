import { z } from "zod";

export const createStationSaleSchema = z.object({
  companyId: z.string().min(1),
  costCenterId: z.string().min(1),
  date: z.coerce.date(),
  liters: z.coerce.number().positive(),
  pricePerLiter: z.coerce.number().positive(),
  shiftNote: z.string().optional(),
});
