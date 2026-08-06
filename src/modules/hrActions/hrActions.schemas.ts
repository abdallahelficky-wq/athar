import { z } from "zod";

// كان actionType نصاً حراً من قائمة ثابتة قبل Phase H — الآن التسوية الشهرية تستهدف بند راتب حقيقي
// (PayrollComponent.id) أو بند نظامي لم يُهاجَر بعد ("legacy:<key>"، انظر legacyPayrollComponents.ts)،
// بدل الأسماء الثابتة القديمة. actionType يبقى عمود توثيقي داخلي يُشتق تلقائياً من البند المختار.
export const createHrActionBatchSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1, "اختر موظفاً واحداً على الأقل"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "صيغة الشهر يجب أن تكون YYYY-MM"),
  componentId: z.string().min(1, "اختر بند الراتب"),
  value: z.coerce.number().min(0).default(0),
  note: z.string().optional(),
});
