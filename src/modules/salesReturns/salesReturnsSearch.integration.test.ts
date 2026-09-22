import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { searchSalesReturns } from "./salesReturnsSearch.service";
import { searchSalesReturnsQuerySchema } from "./salesReturns.schemas";

/**
 * اختبارات تكامل حقيقية على Postgres فعلي — نفس تبرير salesInvoicesSearch.integration.test.ts
 * بالضبط: القيمة الحقيقية هنا (اشتقاق subtype من العميل، تصنيف زاتكا الرباعي، حدود التاريخ بتوقيت
 * الرياض، والملخّص المرحّل فقط) تكمن في SQL الخام نفسه. تُنشئ بياناتها الخاصة ضمن مستأجر معزول
 * وتُنظِّفه بالكامل بعد الانتهاء.
 */
guardAgainstUnsafeIntegrationTestDatabase();

describe("searchSalesReturns (integration)", () => {
  let tenantId: string;
  let otherTenantId: string;
  let companyId: string;
  let otherCompanyId: string;
  let customerStandardId: string; // business + vatNumber => subtype "standard"
  let customerSimplifiedId: string; // no vatNumber => subtype "simplified"
  let accountId: string;
  let invoiceAId: string;
  let invoiceBId: string;

  const returnIds: Record<string, string> = {};

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Test Tenant RET", unlockPin: "hashed" } });
    tenantId = tenant.id;
    const otherTenant = await prisma.tenant.create({ data: { name: "Test Tenant RET Other", unlockPin: "hashed" } });
    otherTenantId = otherTenant.id;

    const company = await prisma.company.create({ data: { tenantId, name: "Co RET A" } });
    companyId = company.id;
    const otherCompany = await prisma.company.create({ data: { tenantId, name: "Co RET B" } });
    otherCompanyId = otherCompany.id;
    const otherTenantCompany = await prisma.company.create({ data: { tenantId: otherTenantId, name: "Co RET Other Tenant" } });

    const account = await prisma.account.create({
      data: { tenantId, companyId, code: "4001", level: 1, isPosting: true, name: "إيرادات مبيعات", type: "revenue" },
    });
    accountId = account.id;

    const customerStandard = await prisma.customer.create({
      data: { tenantId, companyId, name: "شركة الأفق", customerType: "business", vatNumber: "300000000000003" },
    });
    customerStandardId = customerStandard.id;
    const customerSimplified = await prisma.customer.create({ data: { tenantId, companyId, name: "مؤسسة النور" } });
    customerSimplifiedId = customerSimplified.id;

    async function makeInvoice(opts: { invoiceNumber: string; customerId: string; date: Date; grandTotal: number }) {
      const subtotal = opts.grandTotal / 1.15;
      const vatTotal = opts.grandTotal - subtotal;
      return prisma.salesInvoice.create({
        data: {
          tenantId, companyId, customerId: opts.customerId, invoiceNumber: opts.invoiceNumber, date: opts.date,
          invoiceType: "standard", status: "posted", subtotal, vatTotal, grandTotal: opts.grandTotal,
          zatcaStatus: "not_applicable",
          lines: { create: [{ accountId, quantity: 1, unitPrice: subtotal, subtotal, vat: vatTotal, total: opts.grandTotal }] },
        },
      });
    }

    const invoiceA = await makeInvoice({ invoiceNumber: "INV-RET-1001", customerId: customerStandardId, date: new Date("2026-01-01T06:00:00.000Z"), grandTotal: 5000 });
    invoiceAId = invoiceA.id;
    const invoiceB = await makeInvoice({ invoiceNumber: "INV-RET-1002", customerId: customerSimplifiedId, date: new Date("2026-01-02T06:00:00.000Z"), grandTotal: 6000 });
    invoiceBId = invoiceB.id;

    async function makeReturn(opts: {
      key: string;
      returnNumber: string;
      customerId: string;
      relatedInvoiceId?: string;
      date: Date;
      grandTotal: number;
      refundMethod?: "account" | "cash" | "bank";
      status?: "draft" | "posted" | "pending_submission" | "zatca_accepted_posting_incomplete";
      zatcaStatus?: "not_applicable" | "cleared" | "reported" | "not_submitted";
      zatcaResponseRaw?: object | null;
      companyId?: string;
      tenantId?: string;
      reason?: string;
    }) {
      const subtotal = opts.grandTotal / 1.15;
      const vatTotal = opts.grandTotal - subtotal;
      const salesReturn = await prisma.salesReturn.create({
        data: {
          tenantId: opts.tenantId ?? tenantId,
          companyId: opts.companyId ?? companyId,
          customerId: opts.customerId,
          returnNumber: opts.returnNumber,
          relatedInvoiceId: opts.relatedInvoiceId,
          date: opts.date,
          reason: opts.reason,
          refundMethod: opts.refundMethod ?? "account",
          status: (opts.status as never) ?? "posted",
          subtotal,
          vatTotal,
          grandTotal: opts.grandTotal,
          zatcaStatus: (opts.zatcaStatus as never) ?? "not_applicable",
          zatcaResponseRaw: opts.zatcaResponseRaw as never,
          lines: { create: [{ accountId, quantity: 1, unitPrice: subtotal, subtotal, vat: vatTotal, total: opts.grandTotal }] },
        },
      });
      returnIds[opts.key] = salesReturn.id;
      return salesReturn;
    }

    // إشعار الساعة 23:30 بتوقيت الرياض من 2026-01-15 — يجب أن يشمله dateTo=2026-01-15
    await makeReturn({ key: "riyadh2330", returnNumber: "RET-1001", customerId: customerStandardId, relatedInvoiceId: invoiceAId, date: new Date("2026-01-15T20:30:00.000Z"), grandTotal: 500, reason: "بضاعة تالفة" });

    // إشعار الساعة 00:30 بتوقيت الرياض من اليوم التالي — يجب ألا يشمله dateTo=2026-01-15
    await makeReturn({ key: "nextDay0030", returnNumber: "RET-1002", customerId: customerStandardId, relatedInvoiceId: invoiceAId, date: new Date("2026-01-15T21:30:00.000Z"), grandTotal: 600, reason: "بضاعة تالفة" });

    // إشعار العميل المبسّط (subtype=simplified)، بلا فاتورة أصلية مرتبطة
    await makeReturn({ key: "simplified", returnNumber: "RET-2001", customerId: customerSimplifiedId, date: new Date("2026-02-01T06:00:00.000Z"), grandTotal: 300 });

    // إشعار العميل القياسي (subtype=standard) مرتبط بفاتورة أخرى، بطريقة استرداد نقدي
    await makeReturn({ key: "cashRefund", returnNumber: "RET-2002", customerId: customerStandardId, relatedInvoiceId: invoiceAId, date: new Date("2026-02-05T06:00:00.000Z"), grandTotal: 400, refundMethod: "cash", reason: "خطأ في الكمية" });

    // إشعار "مُرسَل" لزاتكا بلا تحذيرات
    await makeReturn({ key: "zatcaSent", returnNumber: "RET-3001", customerId: customerStandardId, relatedInvoiceId: invoiceAId, date: new Date("2026-03-01T06:00:00.000Z"), grandTotal: 150, zatcaStatus: "cleared", zatcaResponseRaw: { validationResults: { warningMessages: [] } }, reason: "استرجاع" });

    // إشعار "مُرسَل مع ملاحظات" لزاتكا
    await makeReturn({ key: "zatcaSentWithNotes", returnNumber: "RET-3002", customerId: customerStandardId, relatedInvoiceId: invoiceAId, date: new Date("2026-03-02T06:00:00.000Z"), grandTotal: 160, zatcaStatus: "cleared", zatcaResponseRaw: { validationResults: { warningMessages: ["ملاحظة"] } }, reason: "استرجاع" });

    // ثلاثة إشعارات بنفس التاريخ (يوم معزول): مسودة، بانتظار الإرسال، ومرحّلة — يثبت أن الملخّص
    // يقتصر دائماً على المرحّلة فقط، حتى بلا فلتر حالة ترحيل من المستخدم.
    await makeReturn({ key: "summaryDraft", returnNumber: "RET-5001", customerId: customerStandardId, date: new Date("2026-05-01T06:00:00.000Z"), grandTotal: 50, status: "draft" });
    await makeReturn({ key: "summaryPending", returnNumber: "RET-5002", customerId: customerStandardId, date: new Date("2026-05-01T07:00:00.000Z"), grandTotal: 60, status: "pending_submission" });
    await makeReturn({ key: "summaryPosted", returnNumber: "RET-5003", customerId: customerStandardId, date: new Date("2026-05-01T08:00:00.000Z"), grandTotal: 90, status: "posted" });

    // إشعارات إضافية بنفس التاريخ لتغطية صفحتين كاملتين بأصغر pageSize (15).
    for (let i = 0; i < 20; i++) {
      await makeReturn({ key: `page${i}`, returnNumber: `RET-4${String(i).padStart(3, "0")}`, customerId: customerStandardId, date: new Date("2026-04-01T06:00:00.000Z"), grandTotal: 100 + i });
    }

    // إشعار في شركة أخرى ضمن نفس المستأجر — يجب ألا يظهر عند الفلترة بـcompanyId المحدَّد
    const otherCompanyCustomer = await prisma.customer.create({ data: { tenantId, companyId: otherCompanyId, name: "عميل شركة أخرى" } });
    await makeReturn({ key: "otherCompany", returnNumber: "RET-9001", customerId: otherCompanyCustomer.id, companyId: otherCompanyId, date: new Date("2026-01-20T06:00:00.000Z"), grandTotal: 999 });

    // إشعار في مستأجر مختلف تماماً — يجب ألا يظهر أبداً بغض النظر عن الفلاتر
    const otherTenantCustomer = await prisma.customer.create({ data: { tenantId: otherTenantId, companyId: otherTenantCompany.id, name: "عميل مستأجر آخر" } });
    await makeReturn({ key: "otherTenant", returnNumber: "RET-9002", customerId: otherTenantCustomer.id, companyId: otherTenantCompany.id, tenantId: otherTenantId, date: new Date("2026-01-20T06:00:00.000Z"), grandTotal: 888 });
  }, 30000);

  afterAll(async () => {
    await prisma.salesReturnLine.deleteMany({ where: { salesReturn: { tenantId: { in: [tenantId, otherTenantId] } } } });
    await prisma.salesReturn.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.salesInvoiceLine.deleteMany({ where: { invoice: { tenantId: { in: [tenantId, otherTenantId] } } } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.account.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.company.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  });

  function parseQuery(raw: Record<string, string>) {
    return searchSalesReturnsQuerySchema.parse({ companyId, ...raw });
  }

  it("scopes strictly to tenant and company: excludes other companies and other tenants", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain(returnIds.otherCompany);
    expect(ids).not.toContain(returnIds.otherTenant);
  });

  it("without companyId, scopes to tenant only (all companies in tenant)", async () => {
    const result = await searchSalesReturns(tenantId, searchSalesReturnsQuerySchema.parse({ pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(returnIds.otherCompany);
    expect(ids).not.toContain(returnIds.otherTenant);
  });

  it("a different tenant's search never sees this tenant's data", async () => {
    const result = await searchSalesReturns(otherTenantId, searchSalesReturnsQuerySchema.parse({ pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain(returnIds.riyadh2330);
    expect(ids).not.toContain(returnIds.otherCompany);
  });

  it("dateTo=2026-01-15 includes the 23:30 Riyadh-time return and excludes the next-day 00:30 one", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ dateFrom: "2026-01-15", dateTo: "2026-01-15", pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(returnIds.riyadh2330);
    expect(ids).not.toContain(returnIds.nextDay0030);
  });

  it("dateFrom/dateTo range filters correctly on the return date", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ dateFrom: "2026-02-01", dateTo: "2026-02-28", pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([returnIds.simplified, returnIds.cashRefund]));
    expect(ids).not.toContain(returnIds.riyadh2330);
    expect(ids).not.toContain(returnIds.zatcaSent);
  });

  it("q matches return number partially", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ q: "2001" }));
    expect(result.items.map((i) => i.id)).toEqual([returnIds.simplified]);
  });

  it("q matches customer name partially, case-insensitively", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ q: "الأفق", pageSize: "200" }));
    expect(result.items.every((i) => i.customerId === customerStandardId)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("q matches the original invoice number partially", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ q: "INV-RET-1001", pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([returnIds.riyadh2330, returnIds.cashRefund]));
  });

  it("amountMin/amountMax filters on grand total inclusively", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ amountMin: "150", amountMax: "160", pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([returnIds.zatcaSent, returnIds.zatcaSentWithNotes]));
    expect(ids).not.toContain(returnIds.simplified);
  });

  it("customerId filters to only that customer's returns", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ customerId: customerSimplifiedId, pageSize: "200" }));
    expect(result.items.every((i) => i.customerId === customerSimplifiedId)).toBe(true);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it("originalInvoiceId filters to returns linked to that invoice", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ originalInvoiceId: invoiceAId, pageSize: "200" }));
    expect(result.items.every((i) => i.relatedInvoiceId === invoiceAId)).toBe(true);
    expect(result.items.map((i) => i.id)).toContain(returnIds.riyadh2330);
    expect(result.items.map((i) => i.id)).not.toContain(returnIds.simplified);
  });

  it("subtype filters standard vs simplified, derived from the customer", async () => {
    const standard = await searchSalesReturns(tenantId, parseQuery({ subtype: "standard", pageSize: "200" }));
    expect(standard.items.map((i) => i.id)).toContain(returnIds.riyadh2330);
    expect(standard.items.map((i) => i.id)).not.toContain(returnIds.simplified);

    const simplified = await searchSalesReturns(tenantId, parseQuery({ subtype: "simplified", pageSize: "200" }));
    expect(simplified.items.map((i) => i.id)).toEqual([returnIds.simplified]);
  });

  it("refundMethod filters cash vs account", async () => {
    const cash = await searchSalesReturns(tenantId, parseQuery({ refundMethod: "cash", pageSize: "200" }));
    expect(cash.items.map((i) => i.id)).toEqual([returnIds.cashRefund]);
  });

  it("zatcaStatus filter reproduces the 4-way UI grouping (sent / sent_with_notes)", async () => {
    const sent = await searchSalesReturns(tenantId, parseQuery({ zatcaStatus: "sent", pageSize: "200" }));
    expect(sent.items.map((i) => i.id)).toContain(returnIds.zatcaSent);
    expect(sent.items.map((i) => i.id)).not.toContain(returnIds.zatcaSentWithNotes);

    const sentWithNotes = await searchSalesReturns(tenantId, parseQuery({ zatcaStatus: "sent_with_notes", pageSize: "200" }));
    expect(sentWithNotes.items.map((i) => i.id)).toEqual([returnIds.zatcaSentWithNotes]);

    const notApplicable = await searchSalesReturns(tenantId, parseQuery({ zatcaStatus: "not_applicable", pageSize: "200" }));
    expect(notApplicable.items.map((i) => i.id)).toContain(returnIds.simplified);
  });

  it("combined filters (dateFrom+dateTo+customerId+amountMin) narrow correctly", async () => {
    const result = await searchSalesReturns(
      tenantId,
      parseQuery({ dateFrom: "2026-02-01", dateTo: "2026-02-28", customerId: customerStandardId, amountMin: "350", pageSize: "200" }),
    );
    expect(result.items.map((i) => i.id)).toEqual([returnIds.cashRefund]);
  });

  it("sorts by grandTotal ascending", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ customerId: customerStandardId, sortBy: "grandTotal", sortDir: "asc", pageSize: "200" }));
    const totals = result.items.map((i) => Number(i.grandTotal));
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it("default sort is date descending then returnNumber descending", async () => {
    const result = await searchSalesReturns(tenantId, parseQuery({ customerId: customerStandardId, pageSize: "200" }));
    for (let i = 1; i < result.items.length; i++) {
      const prev = result.items[i - 1];
      const curr = result.items[i];
      const prevTime = new Date(prev.date).getTime();
      const currTime = new Date(curr.date).getTime();
      expect(prevTime >= currTime).toBe(true);
      if (prevTime === currTime) {
        expect(prev.returnNumber >= curr.returnNumber).toBe(true);
      }
    }
  });

  it("pagination totalCount is correct and stable across pages, with no duplicate/skipped rows", async () => {
    const pageSize = 15;
    const page1 = await searchSalesReturns(tenantId, parseQuery({ customerId: customerStandardId, pageSize: String(pageSize), page: "1" }));
    const page2 = await searchSalesReturns(tenantId, parseQuery({ customerId: customerStandardId, pageSize: String(pageSize), page: "2" }));

    expect(page1.totalCount).toBe(page2.totalCount);
    expect(page1.items.length).toBe(pageSize);
    const allIds = [...page1.items.map((i) => i.id), ...page2.items.map((i) => i.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("summary reflects the FULL filtered set, not just the current page", async () => {
    const pageSize = "15";
    const page1 = await searchSalesReturns(tenantId, parseQuery({ customerId: customerStandardId, dateTo: "2026-04-30", pageSize, page: "1" }));
    const fullPage = await searchSalesReturns(tenantId, parseQuery({ customerId: customerStandardId, dateTo: "2026-04-30", pageSize: "200", page: "1" }));

    expect(page1.summary.count).toBe(fullPage.summary.count);
    expect(page1.summary.count).toBe(page1.totalCount);
    expect(page1.items.length).toBeLessThan(page1.summary.count);
    expect(Number(page1.summary.grandTotal)).toBeCloseTo(Number(fullPage.summary.grandTotal), 2);
    expect(Number(page1.summary.netTotal) + Number(page1.summary.vatTotal)).toBeCloseTo(Number(page1.summary.grandTotal), 1);
  });

  it("summary is restricted to POSTED returns only, even with a draft and a pending return in the result set and no posting-status filter applied", async () => {
    const result = await searchSalesReturns(
      tenantId,
      parseQuery({ dateFrom: "2026-05-01", dateTo: "2026-05-01", pageSize: "200" }),
    );

    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([returnIds.summaryDraft, returnIds.summaryPending, returnIds.summaryPosted]));
    expect(result.totalCount).toBe(3);

    expect(result.summary.count).toBe(1);
    expect(Number(result.summary.grandTotal)).toBeCloseTo(90, 2);
    expect(Number(result.summary.netTotal) + Number(result.summary.vatTotal)).toBeCloseTo(90, 1);
  });

  it("summary ignores the user's posting-status filter entirely and always reflects posted totals for the other active filters", async () => {
    const draftFiltered = await searchSalesReturns(
      tenantId,
      parseQuery({ dateFrom: "2026-05-01", dateTo: "2026-05-01", status: "draft", pageSize: "200" }),
    );
    expect(draftFiltered.items.map((i) => i.id)).toEqual([returnIds.summaryDraft]);
    expect(draftFiltered.summary.count).toBe(1);
    expect(Number(draftFiltered.summary.grandTotal)).toBeCloseTo(90, 2);
  });

  it("rejects an out-of-range pageSize before hitting the database", () => {
    const parsed = searchSalesReturnsQuerySchema.safeParse({ companyId, pageSize: "30" });
    expect(parsed.success).toBe(false);
  });

  it("rejects dateFrom after dateTo before hitting the database", () => {
    const parsed = searchSalesReturnsQuerySchema.safeParse({ companyId, dateFrom: "2026-03-01", dateTo: "2026-01-01" });
    expect(parsed.success).toBe(false);
  });
});
