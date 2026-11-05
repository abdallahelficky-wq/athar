import { normalizeVatNumber } from "../../lib/vatNumber";
import { z } from "zod";

export const createCustomerSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "اسم العميل قصير جداً"),
  customerType: z.enum(["business", "individual"]).default("business"),
  // يُوحَّد (بلا مسافات/شرطات، حروف كبيرة) ولا يُقيَّد بدولة الشركة: العميل أو المورد قد يكون من دولة أخرى
  vatNumber: z.string().optional().transform((v) => (v === undefined ? undefined : normalizeVatNumber(v))),
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
