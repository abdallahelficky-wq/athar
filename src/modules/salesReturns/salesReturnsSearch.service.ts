import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { riyadhDayStartUtc, riyadhDayEndExclusiveUtc } from "../../lib/riyadhDate";
import { zatcaGroupExpr } from "../../lib/zatca/zatcaStatusGroup";
import { SearchSalesReturnsQuery } from "./salesReturns.schemas";

export interface SalesReturnSearchRow {
  id: string;
  returnNumber: string;
  date: Date;
  reason: string | null;
  refundMethod: string | null;
  status: string;
  zatcaStatus: string;
  zatcaGroup: "sent" | "sent_with_notes" | "not_sent" | "not_applicable";
  subtype: "standard" | "simplified";
  subtotal: string;
  vatTotal: string;
  grandTotal: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  companyId: string;
  journalEntryId: string | null;
  relatedInvoiceId: string | null;
  relatedInvoiceNumber: string | null;
  relatedInvoiceDate: Date | null;
}

// دائماً مردودات مرحّلة (status = posted) فقط، بصرف النظر عن فلتر حالة الترحيل الذي اختاره
// المستخدم — نفس منطق forcePostedOnly في salesInvoicesSearch.service.ts بالضبط، راجع تعليق
// buildWhereSql أدناه.
export interface SalesReturnSearchSummary {
  count: number;
  netTotal: string;
  vatTotal: string;
  grandTotal: string;
}

export interface SalesReturnSearchResult {
  items: SalesReturnSearchRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  summary: SalesReturnSearchSummary;
}

// راجع src/lib/zatca/zatcaStatusGroup.ts — مُشترَكة مع فواتير المبيعات (salesInvoicesSearch.service.ts).
const ZATCA_GROUP_EXPR = zatcaGroupExpr("sr");

// مطابق تماماً لـsubtypeForCustomer في src/lib/zatca/chain.ts — يُحدِّد "قياسية/مبسّطة" فعلياً وقت
// حجز سلسلة زاتكا لإشعار الدائن (لا عمود مباشر مخزَّن على SalesReturn نفسه، خلافاً لـ
// SalesInvoice.invoiceType). يُعاد اشتقاقه هنا من نفس عمودي العميل المُستخدَمين هناك بالضبط.
const SUBTYPE_EXPR = Prisma.sql`
  CASE WHEN c."customerType" = 'business' AND c."vatNumber" IS NOT NULL THEN 'standard' ELSE 'simplified' END
`;

const FROM_JOINS = Prisma.sql`
  FROM "sales_returns" sr
  JOIN "customers" c ON c."id" = sr."customerId"
  LEFT JOIN "sales_invoices" si2 ON si2."id" = sr."relatedInvoiceId"
`;

const SORT_COLUMN: Record<SearchSalesReturnsQuery["sortBy"], Prisma.Sql> = {
  date: Prisma.sql`sr."date"`,
  returnNumber: Prisma.sql`sr."returnNumber"`,
  customerName: Prisma.sql`c."name"`,
  grandTotal: Prisma.sql`sr."grandTotal"`,
};

function buildWhereSql(tenantId: string, params: SearchSalesReturnsQuery, opts: { forcePostedOnly?: boolean } = {}): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`sr."tenantId" = ${tenantId}`];
  if (params.companyId) conditions.push(Prisma.sql`sr."companyId" = ${params.companyId}`);
  if (params.q) {
    const like = `%${params.q}%`;
    conditions.push(Prisma.sql`(sr."returnNumber" ILIKE ${like} OR c."name" ILIKE ${like} OR si2."invoiceNumber" ILIKE ${like})`);
  }
  if (params.dateFrom) conditions.push(Prisma.sql`sr."date" >= ${riyadhDayStartUtc(params.dateFrom)}`);
  if (params.dateTo) conditions.push(Prisma.sql`sr."date" < ${riyadhDayEndExclusiveUtc(params.dateTo)}`);
  if (params.amountMin !== undefined) conditions.push(Prisma.sql`sr."grandTotal" >= ${params.amountMin}`);
  if (params.amountMax !== undefined) conditions.push(Prisma.sql`sr."grandTotal" <= ${params.amountMax}`);
  if (params.customerId) conditions.push(Prisma.sql`sr."customerId" = ${params.customerId}`);
  if (params.originalInvoiceId) conditions.push(Prisma.sql`sr."relatedInvoiceId" = ${params.originalInvoiceId}`);
  if (params.refundMethod) conditions.push(Prisma.sql`sr."refundMethod" = ${params.refundMethod}`);
  if (params.subtype) conditions.push(Prisma.sql`(${SUBTYPE_EXPR}) = ${params.subtype}`);
  // ملخّص المجموعة المفلترة (opts.forcePostedOnly) يتجاهل فلتر حالة الترحيل الذي اختاره المستخدم
  // عمداً ويقتصر دائماً على المرحّلة فقط — نفس تبرير forcePostedOnly في salesInvoicesSearch.service.ts.
  if (opts.forcePostedOnly) conditions.push(Prisma.sql`sr."status" = 'posted'::"InvoiceStatus"`);
  else if (params.status) conditions.push(Prisma.sql`sr."status" = ${params.status}::"InvoiceStatus"`);
  if (params.zatcaStatus) conditions.push(Prisma.sql`(${ZATCA_GROUP_EXPR}) = ${params.zatcaStatus}`);
  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

/**
 * قائمة مردودات المبيعات (إشعارات الدائن) بالبحث/الفلترة/الترتيب/الترقيم — نفس بنية
 * searchSalesInvoices بالضبط (راجعها لتبرير التصميم العام). لا علاقة لهذه الدالة بأي منطق
 * توقيع/إرسال زاتكا — قراءة بحتة. companyId اختياري عمداً لنفس سبب searchSalesInvoices
 * (مستخدم بصلاحية "كل الشركات").
 */
export async function searchSalesReturns(tenantId: string, params: SearchSalesReturnsQuery): Promise<SalesReturnSearchResult> {
  const whereSql = buildWhereSql(tenantId, params);
  const summaryWhereSql = buildWhereSql(tenantId, params, { forcePostedOnly: true });
  const dirSql = params.sortDir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // "returnNumber DESC" مُذيَّل دائماً كفارز ثانوي حاسم — نفس تبرير invoiceNumber DESC في
  // salesInvoicesSearch.service.ts بالضبط.
  const orderBySql = Prisma.sql`ORDER BY ${SORT_COLUMN[params.sortBy]} ${dirSql}, sr."returnNumber" DESC`;
  const offset = (params.page - 1) * params.pageSize;

  const [items, countRows, summaryRows] = await Promise.all([
    prisma.$queryRaw<SalesReturnSearchRow[]>(Prisma.sql`
      SELECT
        sr."id", sr."returnNumber", sr."date", sr."reason", sr."refundMethod",
        sr."status", sr."zatcaStatus", sr."subtotal", sr."vatTotal", sr."grandTotal",
        sr."customerId", sr."companyId", sr."journalEntryId", sr."relatedInvoiceId",
        c."name" AS "customerName", c."email" AS "customerEmail",
        si2."invoiceNumber" AS "relatedInvoiceNumber", si2."date" AS "relatedInvoiceDate",
        (${SUBTYPE_EXPR}) AS "subtype",
        (${ZATCA_GROUP_EXPR}) AS "zatcaGroup"
      ${FROM_JOINS}
      ${whereSql}
      ${orderBySql}
      LIMIT ${params.pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS "count" ${FROM_JOINS} ${whereSql}`),
    prisma.$queryRaw<SalesReturnSearchSummary[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS "count",
        COALESCE(SUM(sr."subtotal"), 0) AS "netTotal",
        COALESCE(SUM(sr."vatTotal"), 0) AS "vatTotal",
        COALESCE(SUM(sr."grandTotal"), 0) AS "grandTotal"
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
