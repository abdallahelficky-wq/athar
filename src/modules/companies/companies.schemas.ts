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
  // بادئة ترقيم القيود التسلسلي لهذه الشركة — حرفان إنجليزيان فقط (مثال TP)، بلا افتراض تلقائي؛
  // إرسال نص فارغ يُفرَّغ الحقل عمداً (يُخزَّن NULL) بدل نص فارغ، حتى يبقى قيد التفرّد
  // [tenantId, numberingPrefix] صحيحاً (أكثر من شركة يمكن أن تكون بلا بادئة معاً بلا تعارض).
  numberingPrefix: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toUpperCase()))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), {
      message: "بادئة الترقيم يجب أن تتكون من حرفين إنجليزيين كبيرين فقط (مثال: TP)",
    })
    .nullable()
    .optional(),
  vatFilingFrequency: z.enum(["monthly", "quarterly"]).optional(),
  zakatDeclarationDueDate: z.coerce.date().nullable().optional(),
  lowCashThreshold: z.number().nonnegative().nullable().optional(),
  overdueInvoiceDays: z.number().int().positive().optional(),
  staleDraftDays: z.number().int().positive().optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

export const extractDocumentSchema = z.object({
  docType: z.enum(["cr", "national_address", "vat_certificate"]),
});
