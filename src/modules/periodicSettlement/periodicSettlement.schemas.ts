import { z } from "zod";

export const settlementLineSchema = z.object({
  itemId: z.string().min(1),
  countedQuantity: z.coerce.number().min(0),
  unitCost: z.coerce.number().min(0),
});

export const createSettlementSchema = z.object({
  companyId: z.string().min(1),
  date: z.coerce.date(),
  lines: z.array(settlementLineSchema).min(1),
});
