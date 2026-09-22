import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { riyadhDayStartUtc, riyadhDayEndExclusiveUtc } from "../../lib/riyadhDate";
import { zatcaGroupExpr } from "../../lib/zatca/zatcaStatusGroup";
import { SearchSalesInvoicesQuery } from "./salesInvoices.schemas";

export interface SalesInvoiceSearchRow {
  id: string;
  invoiceNumber: string;
  date: Date;
  dueDate: Date | null;
  customerReference: string | null;
  invoiceType: string;
  status: string;
  zatcaStatus: string;
  zatcaGroup: "sent" | "sent_with_notes" | "not_sent" | "not_applicable";
  subtotal: string;
  vatTotal: string;
  grandTotal: string;
  paidAmount: string;
  accountCreditAmount: string;
  paymentStatus: "مسددة" | "مسددة جزئياً" | "غير مسددة";
  customerId: string;
  customerName: string;
  // بريد العميل ومعرّف القيد المحاسبي — عمودان مباشران بلا أي كلفة إضافية (الأول من join العملاء
  // القائم أصلاً، والثاني عمود مباشر على sales_invoices) يُغنيان الواجهة عن جلب الفاتورة الكاملة
  // فقط لقرار "هل يوجد بريد لإرسال الفاتورة إليه؟" أو لفتح شاشة القيد المحاسبي المرتبط.
  customerEmail: string | null;
  journalEntryId: string | null;
  companyId: string;
}

// دائماً فواتير مرحّلة (status = posted) فقط، بصرف النظر عن فلتر حالة الترحيل الذي اختاره
// المستخدم — راجع تعليق forcePostedOnly في buildWhereSql. القائمة المُرقَّمة (items) تستمر بعرض
// كل الحالات المطابقة لفلاتر المستخدم كما هي؛ هذا التقييد خاص بالملخّص فقط.
export interface SalesInvoiceSearchSummary {
  count: number;
  netTotal: string;
  vatTotal: string;
  grandTotal: string;
}

export interface SalesInvoiceSearchResult {
  items: SalesInvoiceSearchRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  summary: SalesInvoiceSearchSummary;
}

// راجع src/lib/zatca/zatcaStatusGroup.ts — مُشترَكة الآن مع مردودات المبيعات (salesReturnsSearch.service.ts).
const ZATCA_GROUP_EXPR = zatcaGroupExpr("si");

// نفس منطق summarizeInvoiceCredits/withInvoiceCredits في src/lib/invoiceCredits.ts بالضبط (الحقل
// الوحيد الذي تعرضه شاشة الفواتير فعلياً كـ"حالة السداد") — لا receiptAllocations وحدها: مردود
// (إشعار دائن) مُرحَّل يُخصَم من المستحق تماماً كسند قبض، إن كانت طريقة رده "على الحساب" (أو غير
// محدَّدة) لا نقداً/بنكياً (تلك تُصرَف فوراً خارج حساب العميل، فلا تُخفِّض ما "استُحق تحصيله" هنا).
const PAYMENT_STATUS_EXPR = Prisma.sql`
  CASE
    WHEN GREATEST(si."grandTotal" - COALESCE(credit."amount", 0) - COALESCE(paid."amount", 0), 0) <= 0.01 THEN 'مسددة'
    WHEN COALESCE(paid."amount", 0) > 0 OR COALESCE(credit."amount", 0) > 0 THEN 'مسددة جزئياً'
    ELSE 'غير مسددة'
  END
`;

const FROM_JOINS = Prisma.sql`
  FROM "sales_invoices" si
  JOIN "customers" c ON c."id" = si."customerId"
  LEFT JOIN LATERAL (
    SELECT SUM(ra."amount") AS "amount" FROM "receipt_allocations" ra WHERE ra."invoiceId" = si."id"
  ) paid ON true
  LEFT JOIN LATERAL (
    SELECT SUM(sr."grandTotal") AS "amount" FROM "sales_returns" sr
    WHERE sr."relatedInvoiceId" = si."id" AND sr."status" = 'posted'::"InvoiceStatus"
      AND (sr."refundMethod" IS NULL OR sr."refundMethod" = 'account')
  ) credit ON true
`;

const SORT_COLUMN: Record<SearchSalesInvoicesQuery["sortBy"], Prisma.Sql> = {
  date: Prisma.sql`si."date"`,
  invoiceNumber: Prisma.sql`si."invoiceNumber"`,
  customerName: Prisma.sql`c."name"`,
  grandTotal: Prisma.sql`si."grandTotal"`,
};

function buildWhereSql(tenantId: string, params: SearchSalesInvoicesQuery, opts: { forcePostedOnly?: boolean } = {}): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`si."tenantId" = ${tenantId}`];
  if (params.companyId) conditions.push(Prisma.sql`si."companyId" = ${params.companyId}`);
  if (params.q) {
    const like = `%${params.q}%`;
    conditions.push(Prisma.sql`(si."invoiceNumber" ILIKE ${like} OR c."name" ILIKE ${like} OR si."customerReference" ILIKE ${like})`);
  }
  if (params.dateFrom) conditions.push(Prisma.sql`si."date" >= ${riyadhDayStartUtc(params.dateFrom)}`);
  if (params.dateTo) conditions.push(Prisma.sql`si."date" < ${riyadhDayEndExclusiveUtc(params.dateTo)}`);
  if (params.amountMin !== undefined) conditions.push(Prisma.sql`si."grandTotal" >= ${params.amountMin}`);
  if (params.amountMax !== undefined) conditions.push(Prisma.sql`si."grandTotal" <= ${params.amountMax}`);
  if (params.customerId) conditions.push(Prisma.sql`si."customerId" = ${params.customerId}`);
  if (params.invoiceType) conditions.push(Prisma.sql`si."invoiceType" = ${params.invoiceType}::"InvoiceType"`);
  // ملخّص المجموعة المفلترة (opts.forcePostedOnly) يتجاهل فلتر حالة الترحيل الذي اختاره المستخدم
  // عمداً ويقتصر دائماً على المرحّلة فقط — طلب مستخدم صريح: مسودة/بانتظار إرسال زاتكا/ترحيل محلي
  // غير مكتمل لا قيد محاسبي فعلي لها بعد (أو له لكن غير نهائي)، فجمعها مع المرحّلة في "الإجمالي"
  // يُضخّم الأرقام المعروضة بمبالغ لم تُرحَّل فعلياً بعد. القائمة المُرقَّمة نفسها (whereSql بلا هذا
  // الخيار) تستمر بعرض كل الحالات حسب فلتر المستخدم كما هي — هذا التقييد خاص بملخّص الإجمالي فقط.
  if (opts.forcePostedOnly) conditions.push(Prisma.sql`si."status" = 'posted'::"InvoiceStatus"`);
  else if (params.status) conditions.push(Prisma.sql`si."status" = ${params.status}::"InvoiceStatus"`);
  if (params.paymentStatus) conditions.push(Prisma.sql`(${PAYMENT_STATUS_EXPR}) = ${params.paymentStatus}`);
  if (params.zatcaStatus) conditions.push(Prisma.sql`(${ZATCA_GROUP_EXPR}) = ${params.zatcaStatus}`);
  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

/**
 * قائمة فواتير المبيعات بالبحث/الفلترة/الترتيب/الترقيم — كل شيء داخل استعلام قاعدة البيانات (لا
 * فلترة بعد الجلب في الكود إطلاقاً). لا علاقة لهذه الدالة بأي منطق توقيع/إرسال زاتكا — قراءة بحتة.
 * companyId اختياري عمداً (مستخدم بصلاحية "كل الشركات" لا يُمرَّر له أي companyId من enforceCompanyScope
 * أصلاً) — يُطابِق سلوك listSalesInvoices القديم تماماً في هذه الحالة.
 */
export async function searchSalesInvoices(tenantId: string, params: SearchSalesInvoicesQuery): Promise<SalesInvoiceSearchResult> {
  const whereSql = buildWhereSql(tenantId, params);
  const summaryWhereSql = buildWhereSql(tenantId, params, { forcePostedOnly: true });
  const dirSql = params.sortDir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // "invoiceNumber DESC" مُذيَّل دائماً كفارز ثانوي حاسم — الافتراضي المطلوب صراحةً (date تنازلياً
  // ثم رقم الفاتورة تنازلياً)، ويبقى مفيداً حتى مع فرز آخر: يضمن ترتيباً ثابتاً للصفحات (لا تكرار
  // ولا تخطّي صف عند تساوي عدة فواتير في عمود الفرز الأساسي، وهو وارد جداً لعمود مثل التاريخ).
  const orderBySql = Prisma.sql`ORDER BY ${SORT_COLUMN[params.sortBy]} ${dirSql}, si."invoiceNumber" DESC`;
  const offset = (params.page - 1) * params.pageSize;

  const [items, countRows, summaryRows] = await Promise.all([
    prisma.$queryRaw<SalesInvoiceSearchRow[]>(Prisma.sql`
      SELECT
        si."id", si."invoiceNumber", si."date", si."dueDate", si."customerReference", si."invoiceType",
        si."status", si."zatcaStatus", si."subtotal", si."vatTotal", si."grandTotal", si."customerId", si."companyId",
        si."journalEntryId", c."name" AS "customerName", c."email" AS "customerEmail",
        COALESCE(paid."amount", 0) AS "paidAmount",
        COALESCE(credit."amount", 0) AS "accountCreditAmount",
        (${PAYMENT_STATUS_EXPR}) AS "paymentStatus",
        (${ZATCA_GROUP_EXPR}) AS "zatcaGroup"
      ${FROM_JOINS}
      ${whereSql}
      ${orderBySql}
      LIMIT ${params.pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS "count" ${FROM_JOINS} ${whereSql}`),
    prisma.$queryRaw<SalesInvoiceSearchSummary[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS "count",
        COALESCE(SUM(si."subtotal"), 0) AS "netTotal",
        COALESCE(SUM(si."vatTotal"), 0) AS "vatTotal",
        COALESCE(SUM(si."grandTotal"), 0) AS "grandTotal"
      ${FROM_JOINS}
      ${summaryWhereSql}
    `),
  ]);

  return {
    items,
    totalCount: countRows[0]?.count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
    summary: summaryRows[0] ?? { count: 0, netTotal: "0", vatTotal: "0", grandTotal: "0" },
  };
}
