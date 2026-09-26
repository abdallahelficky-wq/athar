import { describe, expect, it, vi } from "vitest";

// CHECK 1 (مراجعة PR #76): pending_submission/zatca_accepted_posting_incomplete لا قيد محاسبي
// لهما بعد (راجع salesInvoices.service.ts) — يجب ألا تظهرا في أي تقرير مبيعات/ضريبة مطلقاً، تماماً
// كمسودة تماماً. المموِّه هنا لا يُعيد بيانات ثابتة، بل يُطبِّق where.status فعلياً على بيانات
// مصطنعة بأربع حالات مختلفة — لو أُزيل أو أُضعِف فلتر status:"posted" في الكود الحقيقي (مثلاً
// استُبدل بـstatus:{notIn:["draft"]})، هذا الاختبار يلتقط ذلك فوراً بظهور فواتير/مردودات إضافية
// في النتيجة، لا فقط بفشل صامت لا يُكتشَف.
function matchesCondition(value: unknown, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
    if ("not" in c) return value !== c.not;
    return true; // شروط تاريخ (gte/lte) غير مستخدَمة في هذه الاختبارات — تُتجاهَل عمداً
  }
  return value === cond;
}
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => matchesCondition(row[key], cond));
}

const TENANT_ID = "tenant-1";
const COMPANY_ID = "company-1";
const CUSTOMER_ID = "customer-1";

// فاتورة واحدة بكل حالة ممكنة، بمبالغ مختلفة تماماً حتى يظهر أي تسرّب فوراً كرقم خاطئ لا مجرد
// عدم تطابق طفيف. كل الحالات الأربع بلا receiptAllocations (لا علاقة للسداد بهذا الاختبار).
const INVOICES = [
  { id: "inv-draft", tenantId: TENANT_ID, companyId: COMPANY_ID, customerId: CUSTOMER_ID, status: "draft", date: new Date("2026-01-05"), grandTotal: 1000, subtotal: 869.57, vatTotal: 130.43, customer: { id: CUSTOMER_ID, name: "عميل تجريبي" }, receiptAllocations: [] },
  { id: "inv-pending", tenantId: TENANT_ID, companyId: COMPANY_ID, customerId: CUSTOMER_ID, status: "pending_submission", date: new Date("2026-01-06"), grandTotal: 2000, subtotal: 1739.13, vatTotal: 260.87, customer: { id: CUSTOMER_ID, name: "عميل تجريبي" }, receiptAllocations: [] },
  { id: "inv-incomplete", tenantId: TENANT_ID, companyId: COMPANY_ID, customerId: CUSTOMER_ID, status: "zatca_accepted_posting_incomplete", date: new Date("2026-01-07"), grandTotal: 4000, subtotal: 3478.26, vatTotal: 521.74, customer: { id: CUSTOMER_ID, name: "عميل تجريبي" }, receiptAllocations: [] },
  { id: "inv-posted", tenantId: TENANT_ID, companyId: COMPANY_ID, customerId: CUSTOMER_ID, status: "posted", date: new Date("2026-01-08"), grandTotal: 100, subtotal: 86.96, vatTotal: 13.04, customer: { id: CUSTOMER_ID, name: "عميل تجريبي" }, receiptAllocations: [] },
];

vi.mock("../../lib/prisma", () => ({
  prisma: {
    salesInvoice: {
      findMany: vi.fn((args: any) => Promise.resolve(INVOICES.filter((r) => matchesWhere(r, args.where)))),
    },
    salesReturn: {
      findMany: vi.fn(() => Promise.resolve([])), // بلا مردودات في هذا الاختبار — التركيز على الفواتير فقط
    },
  },
}));

import { getSalesByCustomer, getSalesVatSummary, getReceivablesAging, invoicesWithPaid } from "./salesReports.service";

describe("sales reports exclude pending_submission / zatca_accepted_posting_incomplete invoices, exactly like draft", () => {
  it("invoicesWithPaid (feeds the sales report) returns only the posted invoice", async () => {
    const result = await invoicesWithPaid(TENANT_ID, COMPANY_ID);
    expect(result.map((i) => i.id)).toEqual(["inv-posted"]);
  });

  it("getSalesByCustomer's totalInvoices reflects only the posted invoice's amount (100), not 7100", async () => {
    const rows = await getSalesByCustomer(TENANT_ID, { companyId: COMPANY_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiceCount).toBe(1);
    expect(rows[0].totalInvoices).toBe(100);
  });

  it("getSalesVatSummary's outputVat reflects only the posted invoice's VAT (13.04), not the sum of all four", async () => {
    const summary = await getSalesVatSummary(TENANT_ID, { companyId: COMPANY_ID });
    expect(summary.salesBase).toBe(86.96);
    expect(summary.outputVat).toBe(13.04);
  });

  it("getReceivablesAging never surfaces the pending/incomplete invoices' due amounts", async () => {
    const aging = await getReceivablesAging(TENANT_ID, { companyId: COMPANY_ID });
    // الفاتورة المرحّلة الوحيدة (100) أقل من الحد الأدنى المعروض (0.5 فرق) فتظهر لو غير مسدَّدة —
    // المهم هنا: لا وجود لأي صف بقيمة 1000/2000/4000 (فواتير draft/pending/incomplete) في الناتج.
    const totals = aging.map((r) => r.total);
    expect(totals).not.toContain(1000);
    expect(totals).not.toContain(2000);
    expect(totals).not.toContain(4000);
    if (aging.length) expect(aging[0].total).toBe(100);
  });
});
