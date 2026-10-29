import { z } from "zod";

const documentSchema = z.object({
  type: z.string().min(1),
  number: z.string().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
});

const employeeSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "اسم الموظف قصير جداً"),
  employeeNumber: z.string().nullable().optional(),
  idNumber: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  maritalStatus: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  workLocation: z.string().nullable().optional(),
  hireDate: z.coerce.date(),
  contractType: z.enum(["unlimited", "limited"]).default("unlimited"),
  contractEnd: z.coerce.date().nullable().optional(),
  basicSalary: z.coerce.number().positive(),
  housingAllowance: z.coerce.number().min(0).default(0),
  transportAllowance: z.coerce.number().min(0).default(0),
  otherAllowance: z.coerce.number().min(0).default(0),
  gosiApplicable: z.boolean().default(false),
  gosiEmployeeRate: z.coerce.number().refine(n => n === 9.75 || n === 10.75).nullable().optional(),
  payrollPaymentMethod: z.enum(["bank", "mudad", "cash"]).nullable().optional(),
  gosiAmount: z.coerce.number().min(0).nullable().optional(),
  advances: z.coerce.number().min(0).default(0),
  otherDeductions: z.coerce.number().min(0).default(0),
  nationality: z.string().nullable().optional(),
  dateOfBirth: z.coerce.date().nullable().optional(),
  phone: z.string().nullable().optional(),
  personalEmail: z.string().email().nullable().optional().or(z.literal("")),
  workEmail: z.string().email().nullable().optional().or(z.literal("")),
  alternatePhone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  emergencyContactName: z.string().nullable().optional(),
  emergencyContactPhone: z.string().nullable().optional(),
  emergencyContactRelation: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  bankAccount: z.string().nullable().optional(),
  medicalInsuranceProvider: z.string().nullable().optional(),
  medicalInsuranceNumber: z.string().nullable().optional(),
  annualLeaveDays: z.coerce.number().int().min(0).default(21),
  notes: z.string().nullable().optional(),
  probationEndDate: z.coerce.date().nullable().optional(),
  probationEvaluated: z.boolean().default(false),
  managerId: z.string().nullable().optional(),
  // محطة عامل ورديات المحطات (مركز تكلفة من نفس الشركة) — يُتحقَّق منها في employees.controller.ts
  assignedCostCenterId: z.string().min(1).nullable().optional(),
  documents: z.array(documentSchema).default([]),
});

export const createEmployeeSchema = employeeSchema.refine(e => !e.gosiApplicable || e.gosiEmployeeRate != null, { path: ['gosiEmployeeRate'], message: 'اختر نسبة خصم تأمينات الموظف' });
export const updateEmployeeSchema = employeeSchema.partial();

export const importEmployeesSchema = z.object({
  companyId: z.string().min(1),
  // الاستيراد لا يُسنِد محطات: لا تحقق لكل صف من مركز التكلفة هنا، فيُستبعَد الحقل تماماً
  rows: z.array(employeeSchema.omit({ companyId: true, assignedCostCenterId: true }).refine(e => !e.gosiApplicable || e.gosiEmployeeRate != null, { path: ["gosiEmployeeRate"], message: "اختر نسبة خصم تأمينات الموظف" })).min(1).max(1000),
});

// أي PIN جديد 6 أرقام بالضبط (رموز 4 أو 5 أرقام ضُبطت سابقاً تبقى صالحة للدخول حتى تُغيَّر). الـ PIN
// اختياري هنا فقط لموظف لديه PIN مضبوط أصلاً — لتعديل الجوال أو إيقاف/تفعيل الدخول دون إعادة ضبطه.
export const setPortalAccessSchema = z.object({
  phone: z.string().trim().min(5, "رقم الجوال قصير جداً"),
  pin: z.string().regex(/^\d{6}$/, "الرمز السري يجب أن يكون 6 أرقام").optional(),
  portalActive: z.boolean().default(true),
});
