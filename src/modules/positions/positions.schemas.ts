import { z } from "zod";

export const createPositionSchema = z.object({
  name: z.string().trim().min(1, "اسم المنصب مطلوب").max(100),
  allowUnpost: z.boolean().optional().default(false),
});

export const updatePositionSchema = z.object({
  allowUnpost: z.boolean(),
});

export const assignMemberSchema = z.object({
  userId: z.string().min(1, "المستخدم مطلوب"),
});
