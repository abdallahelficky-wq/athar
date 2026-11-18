import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "صيغة الشهر يجب أن تكون YYYY-MM");
const amount = z.coerce.number().positive("مبلغ الدفعة يجب أن يكون أكبر من صفر");
const everyMonths = z.coerce.number().int("دورية السداد عدد صحيح من الأشهر").min(1, "دورية السداد شهر واحد على الأقل").max(120, "دورية السداد لا تتجاوز 120 شهراً");
const vatMode = z.enum(["none", "inclusive"]);

export const createLeaseContractSchema = z.object({
  companyId: z.string(),
  title: z.string().min(2, "اسم/عنوان عقد الإيجار قصير جداً"),
  counterparty: z.string().nullable().optional(),
  monthlyRent: z.number().nonnegative().nullable().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  notes: z.string().nullable().optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  vatMode: vatMode.optional(),
  paymentAmount: amount.nullable().optional(),
  paymentEveryMonths: everyMonths.nullable().optional(),
  firstDueDate: z.coerce.date().nullable().optional(),
  expenseAccountId: z.string().min(1).nullable().optional(),
  prepaidAccountId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateLeaseContractSchema = createLeaseContractSchema.partial();

export const applyAccountsSchema = z
  .object({
    companyId: z.string().min(1),
    expenseAccountId: z.string().min(1).nullable().optional(),
    prepaidAccountId: z.string().min(1).nullable().optional(),
    onlyMissing: z.boolean().optional(),
  })
  .strict();

export const generateScheduleSchema = z.object({ until: day.optional() }).strict();

export const createPaymentSchema = z
  .object({
    leaseContractId: z.string().min(1),
    dueDate: day,
    periodFrom: day,
    periodTo: day,
    amount,
    status: z.enum(["due", "waived"]).optional(),
    note: z.string().nullable().optional(),
  })
  .strict();

export const updatePaymentSchema = z
  .object({
    dueDate: day.optional(),
    periodFrom: day.optional(),
    periodTo: day.optional(),
    amount: amount.optional(),
    status: z.enum(["due", "waived"]).optional(),
    note: z.string().nullable().optional(),
  })
  .strict();

export const confirmPaymentSchema = z
  .object({
    paidOn: day,
    bankAccountId: z.string().min(1).optional(),
    amount: amount.optional(),
    reference: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    postedExternally: z.boolean().optional(),
    amortizeFromMonth: month.nullable().optional(),
  })
  .strict();

export const reversePaymentSchema = z.object({ reason: z.string().trim().min(1, "السبب مطلوب"), date: day.optional() }).strict();

export const postAmortizationSchema = z.object({ companyId: z.string().min(1), month }).strict();

export const removeAmortizationSchema = z.object({ pin: z.string().min(1, "الرقم السري مطلوب") }).strict();

export const importSchema = z
  .object({
    companyId: z.string().min(1),
    contracts: z
      .array(
        z
          .object({
            title: z.string().trim().min(2, "اسم/عنوان عقد الإيجار قصير جداً"),
            counterparty: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
            vatMode,
            startDate: day,
            endDate: day,
            costCenterName: z.string().nullable().optional(),
            paymentAmount: amount.nullable().optional(),
            paymentEveryMonths: everyMonths.nullable().optional(),
            firstDueDate: day.nullable().optional(),
            payments: z
              .array(
                z
                  .object({
                    dueDate: day,
                    periodFrom: day,
                    periodTo: day,
                    amount,
                    status: z.enum(["due", "waived", "paid_external"]).optional(),
                    paidOn: day.nullable().optional(),
                    amortizeFromMonth: month.nullable().optional(),
                    note: z.string().nullable().optional(),
                  })
                  .strict(),
              )
              .max(600, "عدد دفعات العقد أكبر من المسموح في استيراد واحد"),
          })
          .strict(),
      )
      .min(1, "ملف الاستيراد لا يحتوي عقوداً")
      .max(500, "عدد العقود أكبر من المسموح في استيراد واحد"),
  })
  .strict();
