import { z } from "zod";
import { BUSINESS_ACTIVITIES } from "../../lib/chartTemplates";
import { COUNTRY_CODES, CURRENCY_CODES } from "../../lib/countries";

export const createCompanySchema = z.object({
  name: z.string().min(2, "اسم الشركة قصير جداً"),
  shortName: z.string().optional(),
  nameEn: z.string().optional(),
  licenseNumber: z.string().optional(),
  unifiedEntityNumber: z.string().optional(),
  // نشاط المنشأة — اختياري: عدم اختياره يزرع القالب الافتراضي العام بدل قالب قطاعي
  businessActivity: z.enum(BUSINESS_ACTIVITIES).nullable().optional(),
  brandColor: z.string().optional(),
  invoiceTemplate: z.enum(["modern", "classicPro"]).optional(),
  defaultPaymentTerms: z.string().optional(),
  defaultDueDays: z.coerce.number().int().positive().nullable().optional(),
  invoiceShowPoNumber: z.boolean().optional(),
  invoiceShowSalesperson: z.boolean().optional(),
  invoiceShowCustomerReference: z.boolean().optional(),
  invoiceShowOtherId: z.boolean().optional(),
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
  // تبدأ البادئة افتراضياً بـ J، ويمكن تخصيصها بحرف أو حرفين إنجليزيين من بيانات الشركة.
  numberingPrefix: z
    .string()
    .trim()
    .transform((v) => (v === "" ? "J" : v.toUpperCase()))
    .refine((v) => /^[A-Z]{1,2}$/.test(v), {
      message: "بادئة الترقيم يجب أن تتكون من حرف أو حرفين إنجليزيين (مثال: J أو TP)",
    })
    .optional(),
  vatFilingFrequency: z.enum(["monthly", "quarterly"]).optional(),
  zakatDeclarationDueDate: z.coerce.date().nullable().optional(),
  lowCashThreshold: z.number().nonnegative().nullable().optional(),
  overdueInvoiceDays: z.number().int().positive().optional(),
  staleDraftDays: z.number().int().positive().optional(),
  // لغة المراسلات الآلية لهذه الشركة (التقرير المالي الدوري المُرسَل بالبريد) — انظر Company.language بالمخطط
  language: z.enum(["ar", "en"]).optional(),
  // الدولة وعملة المحاسبة الخاصتان بهذه الشركة — انظر src/lib/countries.ts والتعليق فوق الحقلين
  // المطابقين بـ schema.prisma. زر امتثال زاتكا يظهر فقط لما country = "SA" (الواجهة الأمامية).
  country: z.enum(COUNTRY_CODES).optional(),
  currency: z.enum(CURRENCY_CODES).optional(),
  // بعده يُمنع إنشاء/تعديل/حذف/فك ترحيل أي قيد بتاريخ يقع فيه أو قبله — راجع src/lib/fiscalClosing.ts.
  // تقديمه للأمام (أو ضبطه لأول مرة) متاح هنا بصلاحية admin/finance_manager كبقية إعدادات الشركة؛
  // تقديمه للخلف أو مسحه ("فتح الإقفال") مرفوض من هذا المسار عمداً (companies.controller.ts) ويتطلب
  // مسار reopenFiscalClosing المخصَّص، admin فقط.
  fiscalYearClosingDate: z.coerce.date().nullable().optional(),
  // إعداد على مستوى الشركة (لا الجهاز) لتفعيل "شاشة البيع السريعة" في نقطة البيع — راجع التعليق
  // فوق الحقل المطابق في schema.prisma.
  posQuickSaleEnabled: z.boolean().optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

export const reopenFiscalClosingSchema = z.object({
  fiscalYearClosingDate: z.coerce.date().nullable(),
});

export const extractDocumentSchema = z.object({
  docType: z.enum(["cr", "national_address", "vat_certificate"]),
});
