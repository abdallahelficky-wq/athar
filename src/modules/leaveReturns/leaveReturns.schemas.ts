import { z } from "zod";

export const registerLeaveReturnSchema = z.object({
  employeeId: z.string().min(1),
  returnDate: z.coerce.date(),
});
