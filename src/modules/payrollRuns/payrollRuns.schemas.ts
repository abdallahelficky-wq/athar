import { z } from "zod";

export const createPayrollRunSchema = z.object({
  companyId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "صيغة الشهر يجب أن تكون YYYY-MM"),
  employeeIds: z.array(z.string().min(1)).min(1, "اختر موظفاً واحداً على الأقل"),
});

export const updateEmployeesSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1),
});

// مفاتيح الكائن هي مُعرِّفات بنود الرواتب (PayrollComponent.id، أو "legacy:<key>" للشركات التي
// لم يُشغَّل لها backfillPayrollComponents.ts بعد) — غير معروفة سلفاً، فلا يمكن التحقق منها كحقول ثابتة.
export const setOverrideSchema = z.record(z.string().min(1), z.coerce.number());

export const unpostSchema = z.object({ pin: z.string().min(1) });
