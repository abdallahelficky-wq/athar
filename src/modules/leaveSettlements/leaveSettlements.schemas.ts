import { z } from "zod";

export const createLeaveSettlementSchema = z.object({
  employeeId: z.string().min(1),
  leaveStartDate: z.coerce.date(),
  leaveEndDate: z.coerce.date().nullable().optional(),
  settlementType: z.enum(["actual_leave", "cash_in_service"]).default("actual_leave"),
  cashLeaveDays: z.coerce.number().positive().optional(),
  bonuses: z.coerce.number().min(0).default(0),
  deductions: z.coerce.number().min(0).default(0),
  ticketAmount: z.coerce.number().min(0).default(0),
  visaAmount: z.coerce.number().min(0).default(0),
});

export const disburseSchema = z.object({
  method: z.enum(["cash", "bank"]),
  date: z.coerce.date(),
});

export const registerReturnSchema = z.object({
  returnDate: z.coerce.date(),
});
