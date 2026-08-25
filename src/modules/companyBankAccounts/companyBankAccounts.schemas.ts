import { z } from "zod";

export const createCompanyBankAccountSchema = z.object({
  companyId: z.string().min(1, "الشركة مطلوبة"),
  bankName: z.string().min(1, "اسم البنك مطلوب"),
  accountNumber: z.string().min(1, "رقم الحساب مطلوب"),
  iban: z.string().min(1, "رقم الآيبان مطلوب"),
  sortOrder: z.number().int().optional(),
});

export const updateCompanyBankAccountSchema = createCompanyBankAccountSchema.partial();
