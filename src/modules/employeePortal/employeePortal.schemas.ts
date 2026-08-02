import { z } from "zod";

export const employeePortalLoginSchema = z.object({
  tenantId: z.string().min(1, "معرّف المنشأة مطلوب"),
  phone: z.string().min(5, "رقم الجوال مطلوب"),
  pin: z.string().min(4, "الرمز السري مطلوب"),
});
