import { z } from "zod";

const pin = z.string().regex(/^\d{6}$/, "الرمز السري يجب أن يكون 6 أرقام");
const phone = z.string().trim().min(5, "رقم الجوال قصير جداً");

export const createStationUserSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().trim().min(2, "اسم المستخدم مطلوب"),
  role: z.enum(["worker", "supervisor"]),
  costCenterId: z.string().min(1).nullish(),
  phone,
  pin,
}).strict();

export const updateStationUserSchema = z.object({
  name: z.string().trim().min(2, "اسم المستخدم مطلوب").optional(),
  role: z.enum(["worker", "supervisor"]).optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  phone: phone.optional(),
  // رمز جديد (إعادة تعيين) — يفكّ القفل أيضاً
  pin: pin.optional(),
  active: z.boolean().optional(),
}).strict();
