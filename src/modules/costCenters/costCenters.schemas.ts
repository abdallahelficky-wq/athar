import { z } from "zod";

export const createCostCenterSchema = z.object({
  name: z.string().min(2, "اسم مركز التكلفة قصير جداً"),
  companyId: z.string().nullable().optional(), // فارغ/null = عام لكل الشركات ضمن المستأجر
});

export const updateCostCenterSchema = createCostCenterSchema.partial();
