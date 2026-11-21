import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD");
const method = z.enum(["regulation_1445", "net_current_assets"]);

export const computeSchema = z
  .object({
    companyId: z.string().min(1),
    periodStart: day,
    periodEnd: day,
    hijriYear: z.boolean().optional(),
    method: method.optional(),
    zakatableOwnershipPct: z.coerce.number().min(0).max(100).optional(),
    adjustments: z.array(z.object({ label: z.string().max(300), amount: z.coerce.number() })).max(100).optional(),
  })
  .strict();

export const settingsSchema = z
  .object({ companyId: z.string().min(1), zakatMethod: method.optional(), zakatableOwnershipPct: z.coerce.number().min(0).max(100).optional() })
  .strict();

export const treatmentSchema = z
  .object({
    treatment: z
      .enum(["equity", "non_current_liability", "current_liability", "deductible_non_current_asset", "non_deductible_non_current_asset", "deductible_current_asset", "current_asset", "excluded"])
      .nullable(),
  })
  .strict();

export const postSchema = z.object({ expenseAccountId: z.string().min(1), payableAccountId: z.string().min(1) }).strict();
