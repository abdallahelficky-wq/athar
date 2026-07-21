import { z } from "zod";

export const createCompanySchema = z.object({
  name: z.string().min(2, "اسم الشركة قصير جداً"),
  shortName: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  brandColor: z.string().optional(),
  vatNumber: z.string().optional(),
  crNumber: z.string().optional(),
  nationalAddress: z.string().optional(),
});

export const updateCompanySchema = createCompanySchema.partial();
