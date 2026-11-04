import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const money = z.coerce.number().finite().min(0).max(99999999).default(0);
export const annualLeaveDraftSchema = z.object({
  companyId: z.string().min(1), employeeId: z.string().min(1), leaveStartDate: date,
  leaveEndDate: date.optional(), balanceMode: z.enum(["all", "through_date", "contract_year"]).default("all"),
  balanceThroughDate: date.optional(), openingDate: date.optional(), openingDays: money, openingAmount: money,
  salaryMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  salaryMode: z.enum(["until_leave", "full_month", "none"]).default("until_leave"),
  ticketAmount: money, otherAdditions: money, additionsReason: z.string().trim().max(1000).default(""),
}).superRefine((v, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (v.otherAdditions > 0 && !v.additionsReason) issue("additionsReason", "سبب الإضافات الأخرى مطلوب");
  if (v.balanceMode === "through_date" && !v.balanceThroughDate) issue("balanceThroughDate", "حدد تاريخ احتساب الرصيد");
  if ((v.openingDays || v.openingAmount) && !v.openingDate) issue("openingDate", "حدد تاريخ الرصيد الافتتاحي");
  if (v.openingAmount > 0 && v.openingDays === 0) issue("openingDays", "مبلغ الرصيد الافتتاحي يتطلب أياماً");
  if (v.leaveEndDate && v.leaveEndDate < v.leaveStartDate) issue("leaveEndDate", "نهاية الإجازة تسبق بدايتها");
});
export type AnnualLeaveDraftInput = z.infer<typeof annualLeaveDraftSchema>;
