import { z } from "zod";

export const createSupplierSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "اسم المورد قصير جداً"),
  vatNumber: z.string().optional(),
  crNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().optional(),
  paymentTerms: z.string().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();
