import { z } from "zod";

export const createCompanyDocumentSchema = z.object({
  companyId: z.string(),
  docType: z.string().min(2, "نوع المستند مطلوب"),
  number: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
});

export const updateCompanyDocumentSchema = createCompanyDocumentSchema.partial();
