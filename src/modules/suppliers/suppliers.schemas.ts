import { normalizeVatNumber } from "../../lib/vatNumber";
import { z } from "zod";

export const createSupplierSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "اسم المورد قصير جداً"),
  // يُوحَّد (بلا مسافات/شرطات، حروف كبيرة) ولا يُقيَّد بدولة الشركة: العميل أو المورد قد يكون من دولة أخرى
  vatNumber: z.string().optional().transform((v) => (v === undefined ? undefined : normalizeVatNumber(v))),
  crNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().optional(),
  paymentTerms: z.string().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();
