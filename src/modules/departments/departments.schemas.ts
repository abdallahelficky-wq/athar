import { z } from "zod";

export const createDepartmentSchema = z.object({
  name: z.string().min(2, "اسم القسم قصير جداً"),
  nameEn: z.string().trim().max(150).nullable().optional(), // الاسم الإنجليزي — فارغ = ارتداد للعربي
  // حساب مصروف رواتب موظفي القسم في قيد الرواتب (بدل حساب بند «الراتب الأساسي»)؛ null = حساب البند كما هو
  salaryExpenseAccountId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(), // فارغ/null = عام لكل الشركات ضمن المستأجر
});

export const updateDepartmentSchema = createDepartmentSchema.partial();
