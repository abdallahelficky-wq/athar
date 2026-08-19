import { z } from "zod";

export const createDepartmentSchema = z.object({
  name: z.string().min(2, "اسم القسم قصير جداً"),
  companyId: z.string().nullable().optional(), // فارغ/null = عام لكل الشركات ضمن المستأجر
});

export const updateDepartmentSchema = createDepartmentSchema.partial();
