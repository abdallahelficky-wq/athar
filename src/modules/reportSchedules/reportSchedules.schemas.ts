import { z } from "zod";

export const upsertReportScheduleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
  dayOfWeek: z.coerce.number().int().min(0, "0 (الأحد) إلى 6 (السبت)").max(6).default(0),
  dayOfMonth: z.coerce.number().int().min(1).max(28, "اختر يوماً بين 1 و28 حتى يصلح لكل الأشهر").default(1),
  hourKsa: z.coerce.number().int().min(0).max(23).default(6),
  includeComprehensiveMonthly: z.coerce.boolean().default(true),
  includeTrialBalance: z.coerce.boolean().default(true),
  includeIncomeStatement: z.coerce.boolean().default(true),
  includeBalanceSheet: z.coerce.boolean().default(true),
  recipientEmails: z.array(z.string().email("بريد إلكتروني غير صالح")).default([]),
  enabled: z.coerce.boolean().default(true),
});
