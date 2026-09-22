import { z } from "zod";
import { searchQueryBaseSchema, DATE_RANGE_ORDER_MESSAGE, AMOUNT_RANGE_ORDER_MESSAGE } from "../../lib/searchQueryBase";

const lineSchema = z.object({
  originalInvoiceLineId: z.string().optional(),
  vatApplicable: z.boolean().default(true),
  accountId: z.string().min(1),
  description: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  priceIncludesVat: z.boolean().default(true),
});

export const createSalesReturnSchema = z.object({
  companyId: z.string().min(1),
  customerId: z.string().min(1),
  relatedInvoiceId: z.string().optional(),
  date: z.coerce.date(),
  reason: z.string().optional(),
  refundMethod: z.enum(["account", "cash", "bank"]).default("account"),
  lines: z.array(lineSchema).min(1),
});

export const updateSalesReturnSchema = createSalesReturnSchema;

export const unpostSchema = z.object({ pin: z.string().min(1) });

export const sendEmailSchema = z.object({ email: z.string().email("بريد إلكتروني غير صالح").optional() });

/**
 * مُدخَلات بحث/فلترة/ترقيم قائمة مردودات المبيعات (searchSalesReturns في
 * salesReturnsSearch.service.ts) — نفس بنية searchSalesInvoicesQuerySchema بالضبط (راجع
 * salesInvoices.schemas.ts)، بحقول مختلفة بحسب ما يملكه SalesReturn تحديداً: لا invoiceType خاص
 * به (subtype يُشتَق من العميل المرتبط، لا عمود مباشر)، لا paymentStatus (إشعار دائن ليس مستحقاً
 * التحصيل بالمعنى الذي تحمله فاتورة)، مع إضافة originalInvoiceId ورد الطريقة (refundMethod) الخاصّين بمردودات المبيعات فقط.
 */
export const searchSalesReturnsQuerySchema = searchQueryBaseSchema
  .extend({
    customerId: z.string().min(1).optional(),
    originalInvoiceId: z.string().min(1).optional(),
    // مُشتَقّ من العميل المرتبط (نفس subtypeForCustomer في src/lib/zatca/chain.ts) — لا عمود مباشر
    // على SalesReturn، راجع الخدمة لبناء تعبير SQL المطابق تماماً.
    subtype: z.enum(["standard", "simplified"]).optional(),
    refundMethod: z.enum(["account", "cash", "bank"]).optional(),
    status: z.enum(["draft", "posted", "pending_submission", "zatca_accepted_posting_incomplete"]).optional(),
    zatcaStatus: z.enum(["sent", "sent_with_notes", "not_sent", "not_applicable"]).optional(),
    sortBy: z.enum(["date", "returnNumber", "customerName", "grandTotal"]).default("date"),
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

export type SearchSalesReturnsQuery = z.infer<typeof searchSalesReturnsQuerySchema>;
