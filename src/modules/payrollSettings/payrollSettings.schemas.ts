import { z } from "zod";

const formulaReferenceSchema = z.union([
  z.object({ kind: z.literal("component"), componentId: z.string().min(1) }),
  z.object({ kind: z.literal("system"), key: z.literal("GROSS_TOTAL") }),
]);

const formulaTermSchema = z.object({
  quantity: z.coerce.number(),
  unitType: z.enum(["hour", "day"]).nullable(),
  reference: formulaReferenceSchema,
});

const formulaSchema = z.object({ terms: z.array(formulaTermSchema).min(1, "الصيغة تحتاج بنداً مرجعياً واحداً على الأقل") });

const adjustmentUnitBasisSchema = z.object({
  unitType: z.enum(["hour", "day"]),
  referenceComponentIds: z.array(z.string().min(1)).min(1),
});

export const createComponentSchema = z
  .object({
    name: z.string().min(1, "اسم البند مطلوب"),
    kind: z.enum(["addition", "deduction"]),
    accountId: z.string().min(1, "اختر الحساب المرتبط"),
    calcMethod: z.enum(["fixed", "formula"]),
    formula: formulaSchema.nullable().optional(),
    adjustmentUnitBasis: adjustmentUnitBasisSchema.nullable().optional(),
    allowsMonthlyAdjustments: z.coerce.boolean().default(true),
    prorateOnPartialMonth: z.coerce.boolean().default(false),
    appliesByDefault: z.coerce.boolean().default(true),
    sortOrder: z.coerce.number().default(0),
  })
  .refine((data) => data.calcMethod !== "formula" || data.formula, { message: "الصيغة المركّبة مطلوبة عند اختيار 'صيغة'", path: ["formula"] });

export const updateComponentSchema = z.object({
  name: z.string().min(1).optional(),
  kind: z.enum(["addition", "deduction"]).optional(),
  accountId: z.string().min(1).optional(),
  calcMethod: z.enum(["fixed", "formula"]).optional(),
  formula: formulaSchema.nullable().optional(),
  adjustmentUnitBasis: adjustmentUnitBasisSchema.nullable().optional(),
  allowsMonthlyAdjustments: z.coerce.boolean().optional(),
  prorateOnPartialMonth: z.coerce.boolean().optional(),
  appliesByDefault: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  sortOrder: z.coerce.number().optional(),
});

export const updateSettingsSchema = z.object({
  standardHoursPerMonth: z.coerce.number().positive().optional(),
  standardDaysPerMonth: z.coerce.number().positive().optional(),
  payslipColumns: z.array(z.object({ componentId: z.string().nullable(), label: z.string().min(1) })).optional(),
});

export const setEmployeeComponentsSchema = z.array(
  z.object({
    componentId: z.string().min(1),
    isActive: z.coerce.boolean().default(true),
    fixedValue: z.coerce.number().nullable().optional(),
  }),
);
