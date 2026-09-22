import { z } from "zod";
import { SEARCH_PAGE_SIZES } from "./searchPagination";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * الحقول المشترَكة بين أي مُدخَلات بحث/فلترة/ترقيم من جانب الخادم (فواتير المبيعات، مردودات
 * المبيعات...) — صفحة/حجم صفحة/بحث سريع/نطاق تاريخ/نطاق مبلغ. كل شاشة تُوسِّعها (extend) بحقول
 * فلاترها الخاصة (نوع المستند، الحالة...) ثم تُمرِّرها لـrefineSearchQueryRanges أدناه لإضافة
 * قواعد التحقق من صحة النطاقين (تاريخ/مبلغ) — لا تكرار لهذا المنطق في كل شاشة على حدة.
 */
export const searchQueryBaseSchema = z.object({
  companyId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((v): v is (typeof SEARCH_PAGE_SIZES)[number] => (SEARCH_PAGE_SIZES as readonly number[]).includes(v), {
      message: `حجم الصفحة يجب أن يكون أحد القيم التالية: ${SEARCH_PAGE_SIZES.join("، ")}`,
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
});

// رسالتا التحقق من النطاقين (تاريخ/مبلغ) — القيمة النصية وحدها مُشترَكة هنا (لا الاستدعاء عبر
// دالة عامة: صياغة .refine() عبر generics في zod تفقد استدلال النوع الدقيق لكل حقل إضافي تُضيفه كل
// شاشة، فبقيت رسالتا الخطأ فقط مشترَكتين، واستدعاء .refine().refine() نفسه مكتوب في كل schema على
// حدة — راجع searchSalesInvoicesQuerySchema وsearchSalesReturnsQuerySchema).
export const DATE_RANGE_ORDER_MESSAGE = "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية";
export const AMOUNT_RANGE_ORDER_MESSAGE = "الحد الأدنى للمبلغ يجب ألا يكون أكبر من الحد الأعلى";
