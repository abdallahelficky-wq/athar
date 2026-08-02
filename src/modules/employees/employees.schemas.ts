import { z } from "zod";

const documentSchema = z.object({
  type: z.string().min(1),
  number: z.string().optional(),
  expiryDate: z.coerce.date().optional(),
});

export const createEmployeeSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "اسم الموظف قصير جداً"),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  hireDate: z.coerce.date(),
  contractType: z.enum(["unlimited", "limited"]).default("unlimited"),
  contractEnd: z.coerce.date().optional(),
  basicSalary: z.coerce.number().positive(),
  housingAllowance: z.coerce.number().min(0).default(0),
  transportAllowance: z.coerce.number().min(0).default(0),
  otherAllowance: z.coerce.number().min(0).default(0),
  gosiApplicable: z.boolean().default(true),
  gosiAmount: z.coerce.number().min(0).optional(),
  advances: z.coerce.number().min(0).default(0),
  otherDeductions: z.coerce.number().min(0).default(0),
  nationality: z.string().optional(),
  dateOfBirth: z.coerce.date().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  probationEndDate: z.coerce.date().nullable().optional(),
  probationEvaluated: z.boolean().default(false),
  managerId: z.string().nullable().optional(),
  documents: z.array(documentSchema).default([]),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();

export const setPortalAccessSchema = z.object({
  phone: z.string().min(5, "رقم الجوال قصير جداً"),
  pin: z.string().regex(/^\d{4,6}$/, "الرمز يجب أن يكون من 4 إلى 6 أرقام"),
  portalActive: z.boolean().default(true),
});
