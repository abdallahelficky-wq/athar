import { z } from "zod";

export const createCompanySchema = z.object({
  name: z.string().min(2, "اسم الشركة قصير جداً"),
  shortName: z.string().optional(),
  brandColor: z.string().optional(),
  vatNumber: z.string().optional(),
  crNumber: z.string().optional(),
  crIssueDate: z.coerce.date().optional(),
  crExpiryDate: z.coerce.date().optional(),
  officialEmail: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  addressBuilding: z.string().optional(),
  addressStreet: z.string().optional(),
  addressDistrict: z.string().optional(),
  addressCity: z.string().optional(),
  addressPostalCode: z.string().optional(),
  addressAdditionalNo: z.string().optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

export const extractDocumentSchema = z.object({
  docType: z.enum(["cr", "national_address", "vat_certificate"]),
});
