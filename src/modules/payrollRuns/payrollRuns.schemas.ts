import { z } from "zod";
import { PAYROLL_ROW_FIELDS } from "../../lib/hrCalculations";

export const createPayrollRunSchema = z.object({
  companyId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "صيغة الشهر يجب أن تكون YYYY-MM"),
  employeeIds: z.array(z.string().min(1)).min(1, "اختر موظفاً واحداً على الأقل"),
});

export const updateEmployeesSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1),
});

const overrideShape = Object.fromEntries(PAYROLL_ROW_FIELDS.map((f) => [f, z.coerce.number().min(0)])) as Record<
  (typeof PAYROLL_ROW_FIELDS)[number],
  z.ZodNumber
>;

export const setOverrideSchema = z.object(overrideShape).partial();

export const unpostSchema = z.object({ pin: z.string().min(1) });
