import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD");
const money = z.coerce.number().nonnegative("مبالغ التسوية لا تكون سالبة");

export const createSettlementSchema = z
  .object({
    companyId: z.string().min(1),
    costCenterId: z.string().min(1),
    channel: z.enum(["network", "fuel_card"]),
    salesFrom: day,
    salesTo: day,
    settledOn: day,
    bankAccountId: z.string().min(1),
    netAmount: money,
    feeAmount: money.optional(),
    feeVatAmount: money.optional(),
    reference: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();

export const reverseSettlementSchema = z.object({ reason: z.string().trim().min(1, "السبب مطلوب"), date: day.optional() }).strict();
