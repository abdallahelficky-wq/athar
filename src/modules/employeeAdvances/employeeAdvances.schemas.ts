import { z } from "zod";

export const createEmployeeAdvanceSchema = z
  .object({
    companyId: z.string().min(1),
    employeeId: z.string().min(1),
    accountId: z.string().min(1, "اختر الحساب المحاسبي الذي ستُسجَّل عليه هذه السلفة"),
    amount: z.coerce.number().positive(),
    // اختياري: بلا قسط شهري = عهدة/سلفة بلا تكامل مع الرواتب، تُسدَّد يدوياً خارج النظام.
    monthlyInstallment: z.coerce.number().positive().optional(),
    startDate: z.coerce.date(),
    paymentMethod: z.enum(["cash", "bank"]).default("cash"),
  })
  .refine((data) => !data.monthlyInstallment || data.monthlyInstallment <= data.amount, {
    message: "القسط الشهري لا يمكن أن يتجاوز مبلغ السلفة",
    path: ["monthlyInstallment"],
  });

export const removeSchema = z.object({ pin: z.string().min(1) });
