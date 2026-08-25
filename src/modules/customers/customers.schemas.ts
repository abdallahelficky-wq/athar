import { z } from "zod";

export const createCustomerSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "اسم العميل قصير جداً"),
  customerType: z.enum(["business", "individual"]).default("business"),
  vatNumber: z.string().optional(),
  crNumber: z.string().optional(),
  nationalId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  buildingNo: z.string().optional(),
  street: z.string().optional(),
  district: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  additionalNo: z.string().optional(),
  unifiedEntityNumber: z.string().optional(),
  paymentTerms: z.string().optional(),
  creditLimit: z.coerce.number().min(0).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const extractCustomerDocumentSchema = z.object({
  docType: z.enum(["cr", "national_address", "vat_certificate"]),
});
