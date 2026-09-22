import { z } from "zod";
import { searchQueryBaseSchema, DATE_RANGE_ORDER_MESSAGE, AMOUNT_RANGE_ORDER_MESSAGE } from "../../lib/searchQueryBase";

export const salesInvoiceLineSchema = z.object({
  accountId: z.string().min(1),
  // سلسلة فارغة (لا يوجد صنف مختار من الكتالوج — وصف حر) تُعامَل كغياب القيمة، حتى لا تُرسَل
  // كمعرّف علاقة فارغ ينتهك قيد المفتاح الأجنبي عند الحفظ في قاعدة البيانات
  itemId: z.string().optional().transform((v) => (v ? v : undefined)),
  description: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  priceIncludesVat: z.boolean().default(true),
  vatApplicable: z.boolean().default(true),
});

export const createSalesInvoiceSchema = z.object({
  companyId: z.string().min(1),
  customerId: z.string().min(1),
  // فرع اختياري تابع لنفس الشركة — تصنيف/عرض فقط، انظر Branch بالمخطط.
  branchId: z.string().nullable().optional(),
  date: z.coerce.date(),
  // حقول اختيارية بحتة تظهر في شريط معلومات الفاتورة لبعض القوالب — لا تأثير محاسبي/ضريبي لها
  dueDate: z.coerce.date().nullable().optional(),
  customerReference: z.string().optional(),
  poNumber: z.string().optional(),
  salesperson: z.string().optional(),
  otherId: z.string().optional(),
  lines: z.array(salesInvoiceLineSchema).min(1),
  post: z.boolean().default(true),
});

export const updateSalesInvoiceSchema = createSalesInvoiceSchema;

export const unpostSchema = z.object({ pin: z.string().min(1) });

export const sendEmailSchema = z.object({ email: z.string().email("بريد إلكتروني غير صالح").optional() });

// مُعاد تصديرها للتوافق مع الاختبار القائم — القيمة الفعلية الآن في src/lib/searchPagination.ts
// (مُشترَكة مع مردودات المبيعات، راجع salesReturns.schemas.ts).
export { SEARCH_PAGE_SIZES as INVOICE_SEARCH_PAGE_SIZES } from "../../lib/searchPagination";

/**
 * مُدخَلات بحث/فلترة/ترقيم قائمة فواتير المبيعات (searchSalesInvoices في
 * salesInvoicesSearch.service.ts) — تُطبَّق بالكامل داخل استعلام قاعدة البيانات، لا بعد الجلب.
 * كل قيمة نصية قادمة من req.query (Express لا يُحوِّل الاستعلامات تلقائياً)، لذا z.coerce لكل رقم.
 * الحقول المشترَكة (صفحة/بحث سريع/نطاق تاريخ/نطاق مبلغ) من searchQueryBaseSchema — راجع
 * salesReturns.schemas.ts لنفس الأساس مُوسَّعاً بحقول مردودات المبيعات بدل هذه الحقول.
 */
export const searchSalesInvoicesQuerySchema = searchQueryBaseSchema
  .extend({
    customerId: z.string().min(1).optional(),
    invoiceType: z.enum(["standard", "simplified"]).optional(),
    status: z.enum(["draft", "posted", "pending_submission", "zatca_accepted_posting_incomplete"]).optional(),
    paymentStatus: z.enum(["مسددة", "مسددة جزئياً", "غير مسددة"]).optional(),
    // نفس التصنيف الرباعي المعروض أصلاً في شاشة الفواتير (راجع invoiceZatcaState.js بالواجهة) —
    // لا قيم enum زاتكا الخام (تسع قيم مربكة كفلتر) — sent/sent_with_notes مبنيّتان من zatcaStatus
    // وتحذيرات zatcaResponseRaw معاً، بنفس منطق الواجهة الحالي تماماً (راجع الخدمة).
    zatcaStatus: z.enum(["sent", "sent_with_notes", "not_sent", "not_applicable"]).optional(),
    sortBy: z.enum(["date", "invoiceNumber", "customerName", "grandTotal"]).default("date"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, {
    message: DATE_RANGE_ORDER_MESSAGE,
    path: ["dateFrom"],
  })
  .refine((data) => data.amountMin === undefined || data.amountMax === undefined || data.amountMin <= data.amountMax, {
    message: AMOUNT_RANGE_ORDER_MESSAGE,
    path: ["amountMin"],
  });

export type SearchSalesInvoicesQuery = z.infer<typeof searchSalesInvoicesQuerySchema>;
