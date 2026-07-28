import { z } from "zod";

export const lineSchema = z
  .object({
    accountId: z.string().min(1, "الحساب مطلوب"),
    costCenterId: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    customerId: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional(),
    employeeId: z.string().nullable().optional(),
  })
  .refine((l) => (l.debit > 0) !== (l.credit > 0), {
    message: "كل سطر يجب أن يحمل مبلغاً في المدين أو الدائن فقط، وليس كليهما أو لا شيء",
  });

export const createJournalEntrySchema = z.object({
  companyId: z.string().min(1, "الشركة مطلوبة"),
  date: z.coerce.date(),
  memo: z.string().optional(),
  lines: z.array(lineSchema).min(2, "القيد يجب أن يحتوي على سطرين على الأقل"),
});

export const updateJournalEntrySchema = createJournalEntrySchema;

export const unpostSchema = z.object({
  pin: z.string().min(1, "الرقم السري مطلوب"),
});

export const createFromDocumentSchema = z.object({
  companyId: z.string().min(1, "الشركة مطلوبة"),
});

export const mirrorSuggestionSchema = z.object({
  targetCompanyId: z.string().min(1, "الشركة المستهدفة مطلوبة"),
});

export const createMirrorSchema = z.object({
  targetCompanyId: z.string().min(1, "الشركة المستهدفة مطلوبة"),
  date: z.coerce.date(),
  memo: z.string().optional(),
  lines: z.array(lineSchema).min(2, "القيد يجب أن يحتوي على سطرين على الأقل"),
});

export const importJournalEntriesSchema = z.object({
  companyId: z.string().min(1, "اختر شركة محددة أولاً"),
  rows: z
    .array(
      z.object({
        date: z.string(),
        memo: z.string().optional().default(""),
        debitAccountName: z.string(),
        debitAmount: z.coerce.number(),
        creditAccountName: z.string(),
        creditAmount: z.coerce.number(),
      }),
    )
    .min(1),
});
