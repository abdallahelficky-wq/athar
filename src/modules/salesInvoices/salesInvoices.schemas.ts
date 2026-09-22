import { z } from "zod";

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

// أحجام صفحة محدَّدة سلفاً فقط — لا حجم حرّ (يمنع طلب صفحة بحجم ضخم يُثقِل قاعدة البيانات).
export const INVOICE_SEARCH_PAGE_SIZES = [15, 25, 50, 100, 200] as const;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * مُدخَلات بحث/فلترة/ترقيم قائمة فواتير المبيعات (searchSalesInvoices في
 * salesInvoicesSearch.service.ts) — تُطبَّق بالكامل داخل استعلام قاعدة البيانات، لا بعد الجلب.
 * كل قيمة نصية قادمة من req.query (Express لا يُحوِّل الاستعلامات تلقائياً)، لذا z.coerce لكل رقم.
 */
export const searchSalesInvoicesQuerySchema = z
  .object({
    companyId: z.string().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((v): v is (typeof INVOICE_SEARCH_PAGE_SIZES)[number] => (INVOICE_SEARCH_PAGE_SIZES as readonly number[]).includes(v), {
        message: `حجم الصفحة يجب أن يكون أحد القيم التالية: ${INVOICE_SEARCH_PAGE_SIZES.join("، ")}`,
      })
      .default(25),
    q: z
      .string()
      .trim()
      .min(1)
      .optional()
      .transform((v) => v || undefined),
    dateFrom: z.string().regex(DATE_ONLY_RE, "تاريخ البداية يجب أن يكون بصيغة YYYY-MM-DD").optional(),
    dateTo: z.string().regex(DATE_ONLY_RE, "تاريخ النهاية يجب أن يكون بصيغة YYYY-MM-DD").optional(),
    amountMin: z.coerce.number().optional(),
    amountMax: z.coerce.number().optional(),
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
    message: "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية",
    path: ["dateFrom"],
  })
  .refine((data) => data.amountMin === undefined || data.amountMax === undefined || data.amountMin <= data.amountMax, {
    message: "الحد الأدنى للمبلغ يجب ألا يكون أكبر من الحد الأعلى",
    path: ["amountMin"],
  });

export type SearchSalesInvoicesQuery = z.infer<typeof searchSalesInvoicesQuerySchema>;
