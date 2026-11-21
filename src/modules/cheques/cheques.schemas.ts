import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD");

export const createChequeSchema = z
  .object({
    companyId: z.string().min(1),
    direction: z.enum(["received", "issued"]),
    chequeNumber: z.string().trim().min(1, "رقم الشيك مطلوب").max(50),
    bankName: z.string().max(120).optional().nullable(),
    issueDate: day,
    dueDate: day,
    amount: z.coerce.number(),
    customerId: z.string().optional().nullable(),
    supplierId: z.string().optional().nullable(),
    counterAccountId: z.string().optional().nullable(),
    partyName: z.string().max(200).optional().nullable(),
    memo: z.string().max(500).optional().nullable(),
  })
  .strict();

export const chequeActionSchema = z
  .object({ date: day, bankAccountId: z.string().optional().nullable(), note: z.string().max(500).optional().nullable() })
  .strict();

export const chequeSettingsSchema = z
  .object({ companyId: z.string().min(1), chequesReceivableAccountId: z.string().nullable().optional(), chequesPayableAccountId: z.string().nullable().optional() })
  .strict();
