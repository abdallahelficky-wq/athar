import { z } from "zod";
import { depreciationMethodSchema, rejectUnsupportedDepreciationMethod } from "../fixedAssets/fixedAssets.schemas";

// حقول تسجيل أصل ثابت جديد ضمن سطر قيد عام (Phase F) — بلا companyId/accountId/paymentMethod:
// الشركة والحساب المحاسبي محدَّدان مسبقاً من سياق القيد والسطر نفسه (accountId = حساب هذا السطر
// تحديداً)، والتكلفة = مبلغ السطر (مدين) مباشرة بدل حقل منفصل، فلا قيد إضافي يُنشأ (هذا السطر نفسه
// هو القيد المحاسبي للاقتناء).
export const newFixedAssetOnLineSchema = z
  .object({
    name: z.string().min(2, "اسم الأصل قصير جداً"),
    // إلزامية — بدونها لا يرث الأصل حسابَي مجمع/مصروف الإهلاك ويقع على الحسابات الاحتياطية
    // المشتركة بدل حسابات فئته. تُتحقَّق أيضاً في journalEntries.service.ts أن حساب اقتناء هذه
    // الفئة يطابق حساب السطر نفسه (لا يكفي التحقق هنا وحده لأنه لا يعرف حساب السطر).
    categoryId: z.string().min(1, "فئة الأصل مطلوبة"),
    serialNumber: z.string().optional(),
    chassisNumber: z.string().optional(),
    plateNumber: z.string().optional(),
    costCenterId: z.string().optional(),
    custodianEmployeeId: z.string().optional(),
    depreciationStartDate: z.coerce.date().optional(),
    usefulLifeYears: z.coerce.number().positive(),
    salvageValue: z.coerce.number().min(0).default(0),
    depreciationMethod: depreciationMethodSchema,
    isDepreciable: z.coerce.boolean().default(true),
  })
  .superRefine(rejectUnsupportedDepreciationMethod);

// حقول تسجيل سلفة/عهدة موظف جديدة ضمن سطر قيد عام — بلا companyId/accountId/paymentMethod لنفس
// السبب أعلاه؛ الموظف يُؤخَذ من employeeId الخاص بالسطر نفسه (حقل موجود بالفعل)، لا حقل منفصل هنا.
export const newEmployeeAdvanceOnLineSchema = z.object({
  monthlyInstallment: z.coerce.number().positive().optional(),
});

export const lineSchema = z
  .object({
    accountId: z.string().min(1, "الحساب مطلوب"),
    costCenterId: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    departmentId: z.string().nullable().optional(),
    // فرع اختياري تابع لنفس الشركة — تصنيف/عرض فقط، على مستوى السطر (بنفس أسلوب مركز التكلفة/
    // القسم) لأن قيداً واحداً قد تتوزع سطوره على فروع مختلفة.
    branchId: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    customerId: z.string().nullable().optional(),
    supplierId: z.string().nullable().optional(),
    employeeId: z.string().nullable().optional(),
    fixedAssetId: z.string().nullable().optional(),
    employeeAdvanceId: z.string().nullable().optional(),
    newFixedAsset: newFixedAssetOnLineSchema.nullable().optional(),
    newEmployeeAdvance: newEmployeeAdvanceOnLineSchema.nullable().optional(),
  })
  .refine((l) => (l.debit > 0) !== (l.credit > 0), {
    message: "كل سطر يجب أن يحمل مبلغاً في المدين أو الدائن فقط، وليس كليهما أو لا شيء",
  })
  .refine((l) => !(l.fixedAssetId && l.newFixedAsset), {
    message: "اختر إما أصلاً موجوداً أو سجّل أصلاً جديداً، وليس كليهما لنفس السطر",
  })
  .refine((l) => !(l.employeeAdvanceId && l.newEmployeeAdvance), {
    message: "اختر إما سلفة موجودة أو سجّل سلفة جديدة، وليس كليهما لنفس السطر",
  })
  .refine((l) => !l.newEmployeeAdvance || l.employeeId, {
    message: "حدّد الموظف المستفيد من السلفة الجديدة على هذا السطر",
  });

export const createJournalEntrySchema = z.object({
  companyId: z.string().min(1, "الشركة مطلوبة"),
  date: z.coerce.date(),
  memo: z.string().optional(),
  lines: z.array(lineSchema).min(2, "القيد يجب أن يحتوي على سطرين على الأقل"),
  // true = "حفظ وترحيل" (يُنشأ مرحّلاً مباشرة)، false/غائب = "حفظ" (يُنشأ محفوظاً قابلاً للتعديل)
  post: z.boolean().optional(),
});

export const updateJournalEntrySchema = createJournalEntrySchema.omit({ post: true });

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

export const reverseJournalEntrySchema = z.object({
  date: z.coerce.date(),
});

