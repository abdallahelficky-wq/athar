import { z } from "zod";

export const createLeaveRequestSchema = z.object({
  employeeId: z.string().min(1),
  type: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  note: z.string().optional(),
});

export const updateLeaveRequestSchema = z.object({
  type: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  note: z.string().optional(),
});
