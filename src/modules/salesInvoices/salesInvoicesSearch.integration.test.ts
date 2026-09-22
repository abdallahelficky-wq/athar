import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { searchSalesInvoices } from "./salesInvoicesSearch.service";
import { searchSalesInvoicesQuerySchema } from "./salesInvoices.schemas";

/**
 * اختبارات تكامل حقيقية على Postgres فعلي (لا Prisma مُموَّهة) — القيمة الحقيقية لهذه الميزة
 * (حساب "حالة السداد" عبر عدة جداول، تصنيف زاتكا الرباعي، حدود التاريخ بتوقيت الرياض، والترقيم/
 * الإجمالي على المجموعة المفلترة كاملة) تكمن في SQL الخام نفسه؛ تمويه $queryRaw لا يختبر شيئاً من
 * هذا المنطق فعلياً. تُنشئ بياناتها الخاصة ضمن مستأجر معزول وتُنظِّفه بالكامل بعد الانتهاء.
 */
// يُنفَّذ فوراً لحظة تحميل هذا الملف (خارج أي describe/beforeAll) — قبل أي prisma.*.create فعلي
// أدناه بسطر واحد فقط. راجع integrationTestGuard.ts لسبب وجوده.
guardAgainstUnsafeIntegrationTestDatabase();

describe("searchSalesInvoices (integration)", () => {
  let tenantId: string;
  let otherTenantId: string;
  let companyId: string;
  let otherCompanyId: string;
  let customerAId: string;
  let customerBId: string;
  let accountId: string;

  const invoiceIds: Record<string, string> = {};

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Test Tenant H", unlockPin: "hashed" } });
    tenantId = tenant.id;
    const otherTenant = await prisma.tenant.create({ data: { name: "Test Tenant H Other", unlockPin: "hashed" } });
    otherTenantId = otherTenant.id;

    const company = await prisma.company.create({ data: { tenantId, name: "Co A" } });
    companyId = company.id;
    const otherCompany = await prisma.company.create({ data: { tenantId, name: "Co B" } });
    otherCompanyId = otherCompany.id;
    const otherTenantCompany = await prisma.company.create({ data: { tenantId: otherTenantId, name: "Co Other Tenant" } });

    const account = await prisma.account.create({
      data: { tenantId, companyId, code: "4001", level: 1, isPosting: true, name: "إيرادات مبيعات", type: "revenue" },
    });
    accountId = account.id;

    const customerA = await prisma.customer.create({ data: { tenantId, companyId, name: "شركة الأفق" } });
    customerAId = customerA.id;
    const customerB = await prisma.customer.create({ data: { tenantId, companyId, name: "مؤسسة النور" } });
    customerBId = customerB.id;

    async function makeInvoice(opts: {
      key: string;
      invoiceNumber: string;
      customerId: string;
      companyId: string;
      tenantId: string;
      date: Date;
      grandTotal: number;
      invoiceType?: "standard" | "simplified";
      status?: "draft" | "posted" | "pending_submission" | "zatca_accepted_posting_incomplete";
      zatcaStatus?: "not_applicable" | "cleared" | "reported" | "not_submitted";
      zatcaResponseRaw?: object | null;
      customerReference?: string;
    }) {
      const subtotal = opts.grandTotal / 1.15;
      const vatTotal = opts.grandTotal - subtotal;
      const invoice = await prisma.salesInvoice.create({
        data: {
          tenantId: opts.tenantId,
          companyId: opts.companyId,
          customerId: opts.customerId,
          invoiceNumber: opts.invoiceNumber,
          date: opts.date,
          invoiceType: opts.invoiceType ?? "standard",
          status: (opts.status as never) ?? "posted",
          subtotal,
          vatTotal,
          grandTotal: opts.grandTotal,
          zatcaStatus: (opts.zatcaStatus as never) ?? "not_applicable",
          zatcaResponseRaw: opts.zatcaResponseRaw as never,
          customerReference: opts.customerReference,
          lines: {
            create: [
              {
                accountId,
                quantity: 1,
                unitPrice: subtotal,
                subtotal,
                vat: vatTotal,
                total: opts.grandTotal,
              },
            ],
          },
        },
      });
      invoiceIds[opts.key] = invoice.id;
      return invoice;
    }

    // فاتورة الساعة 23:30 بتوقيت الرياض من 2026-01-15 — يجب أن يشملها dateTo=2026-01-15
    await makeInvoice({
      key: "riyadh2330",
      invoiceNumber: "INV-1001",
      customerId: customerAId,
      companyId,
      tenantId,
      date: new Date("2026-01-15T20:30:00.000Z"),
      grandTotal: 1000,
    });

    // فاتورة الساعة 00:30 بتوقيت الرياض من اليوم التالي (2026-01-16) — يجب ألا يشملها dateTo=2026-01-15
    await makeInvoice({
      key: "nextDay0030",
      invoiceNumber: "INV-1002",
      customerId: customerAId,
      companyId,
      tenantId,
      date: new Date("2026-01-15T21:30:00.000Z"),
      grandTotal: 2000,
    });

    // فاتورة مسددة بالكامل (سند قبض يغطي كامل المبلغ)
    const paidInvoice = await makeInvoice({
      key: "paid",
      invoiceNumber: "INV-1003",
      customerId: customerBId,
      companyId,
      tenantId,
      date: new Date("2026-02-01T06:00:00.000Z"),
      grandTotal: 500,
      customerReference: "PO-777",
    });
    const receipt = await prisma.receipt.create({
      data: { tenantId, companyId, customerId: customerBId, receiptNumber: "REC-1", date: new Date("2026-02-02"), method: "cash", totalAmount: 500 },
    });
    await prisma.receiptAllocation.create({ data: { receiptId: receipt.id, invoiceId: paidInvoice.id, amount: 500 } });

    // فاتورة مسددة جزئياً عبر إشعار دائن (مردود مرحّل بطريقة رد "على الحساب")
    const partiallyPaidInvoice = await makeInvoice({
      key: "partiallyPaidByCredit",
      invoiceNumber: "INV-1004",
      customerId: customerBId,
      companyId,
      tenantId,
      date: new Date("2026-02-05T06:00:00.000Z"),
      grandTotal: 1000,
    });
    await prisma.salesReturn.create({
      data: {
        tenantId,
        companyId,
        customerId: customerBId,
        returnNumber: "RET-1",
        relatedInvoiceId: partiallyPaidInvoice.id,
        date: new Date("2026-02-06"),
        status: "posted",
        refundMethod: "account",
        subtotal: 300 / 1.15,
        vatTotal: 300 - 300 / 1.15,
        grandTotal: 300,
      },
    });

    // فاتورة غير مسددة إطلاقاً
    await makeInvoice({
      key: "unpaid",
      invoiceNumber: "INV-1005",
      customerId: customerAId,
      companyId,
      tenantId,
      date: new Date("2026-02-10T06:00:00.000Z"),
      grandTotal: 3000,
      invoiceType: "simplified",
    });

    // فاتورة "مُرسَلة" لزاتكا بلا تحذيرات
    await makeInvoice({
      key: "zatcaSent",
      invoiceNumber: "INV-1006",
      customerId: customerAId,
      companyId,
      tenantId,
      date: new Date("2026-03-01T06:00:00.000Z"),
      grandTotal: 400,
      zatcaStatus: "cleared",
      zatcaResponseRaw: { validationResults: { warningMessages: [] } },
    });

    // فاتورة "مُرسَلة مع ملاحظات" لزاتكا
    await makeInvoice({
      key: "zatcaSentWithNotes",
      invoiceNumber: "INV-1007",
      customerId: customerAId,
      companyId,
      tenantId,
      date: new Date("2026-03-02T06:00:00.000Z"),
      grandTotal: 450,
      zatcaStatus: "cleared",
      zatcaResponseRaw: { validationResults: { warningMessages: ["ملاحظة"] } },
    });

    // ثلاث فواتير بنفس التاريخ (يوم معزول لا تتقاطع فيه فواتير أخرى): مسودة، بانتظار إرسال زاتكا،
    // ومرحّلة — لإثبات أن ملخّص الإجمالي (summary) يقتصر دائماً على المرحّلة فقط، حتى عندما لا
    // يُحدَّد المستخدم أي فلتر لحالة الترحيل (فيرى القائمة المُرقَّمة الثلاث كلها كما هي).
    await makeInvoice({
      key: "summaryDraft",
      invoiceNumber: "INV-5001",
      customerId: customerAId,
      companyId,
      tenantId,
      date: new Date("2026-05-01T06:00:00.000Z"),
      grandTotal: 500,
      status: "draft",
    });
    await makeInvoice({
      key: "summaryPending",
      invoiceNumber: "INV-5002",
      customerId: customerAId,
      companyId,
      tenantId,
      date: new Date("2026-05-01T07:00:00.000Z"),
      grandTotal: 600,
      status: "pending_submission",
    });
    await makeInvoice({
      key: "summaryPosted",
      invoiceNumber: "INV-5003",
      customerId: customerAId,
      companyId,
      tenantId,
      date: new Date("2026-05-01T08:00:00.000Z"),
      grandTotal: 900,
      status: "posted",
    });

    // فواتير إضافية بنفس التاريخ — تكفي لتغطية صفحتين كاملتين بأصغر pageSize مسموح به (15)،
    // لاختبار الترقيم (totalCount عبر الصفحات) والترتيب الثانوي عند تساوي عمود الفرز الأساسي.
    for (let i = 0; i < 20; i++) {
      await makeInvoice({
        key: `page${i}`,
        invoiceNumber: `INV-2${String(i).padStart(3, "0")}`,
        customerId: customerAId,
        companyId,
        tenantId,
        date: new Date("2026-04-01T06:00:00.000Z"),
        grandTotal: 100 + i,
      });
    }

    // فاتورة في شركة أخرى ضمن نفس المستأجر — يجب ألا تظهر عند الفلترة بـcompanyId المحدَّد
    await makeInvoice({
      key: "otherCompany",
      invoiceNumber: "INV-3001",
      customerId: (await prisma.customer.create({ data: { tenantId, companyId: otherCompanyId, name: "عميل شركة أخرى" } })).id,
      companyId: otherCompanyId,
      tenantId,
      date: new Date("2026-01-20T06:00:00.000Z"),
      grandTotal: 999,
    });

    // فاتورة في مستأجر مختلف تماماً — يجب ألا تظهر أبداً بغض النظر عن الفلاتر
    await makeInvoice({
      key: "otherTenant",
      invoiceNumber: "INV-9001",
      customerId: (await prisma.customer.create({ data: { tenantId: otherTenantId, companyId: otherTenantCompany.id, name: "عميل مستأجر آخر" } })).id,
      companyId: otherTenantCompany.id,
      tenantId: otherTenantId,
      date: new Date("2026-01-20T06:00:00.000Z"),
      grandTotal: 888,
    });
  }, 30000);

  afterAll(async () => {
    await prisma.receiptAllocation.deleteMany({ where: { receipt: { tenantId: { in: [tenantId, otherTenantId] } } } });
    await prisma.receipt.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.salesReturn.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.salesInvoiceLine.deleteMany({ where: { invoice: { tenantId: { in: [tenantId, otherTenantId] } } } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.account.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.company.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  });

  function parseQuery(raw: Record<string, string>) {
    return searchSalesInvoicesQuerySchema.parse({ companyId, ...raw });
  }

  it("scopes strictly to tenant and company: excludes other companies and other tenants", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain(invoiceIds.otherCompany);
    expect(ids).not.toContain(invoiceIds.otherTenant);
  });

  it("without companyId, scopes to tenant only (all companies in tenant)", async () => {
    const result = await searchSalesInvoices(tenantId, searchSalesInvoicesQuerySchema.parse({ pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(invoiceIds.otherCompany);
    expect(ids).not.toContain(invoiceIds.otherTenant);
  });

  it("a different tenant's search never sees this tenant's data", async () => {
    const result = await searchSalesInvoices(otherTenantId, searchSalesInvoicesQuerySchema.parse({ pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain(invoiceIds.riyadh2330);
    expect(ids).not.toContain(invoiceIds.otherCompany);
  });

  it("dateTo=2026-01-15 includes the 23:30 Riyadh-time invoice and excludes the next-day 00:30 one", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ dateFrom: "2026-01-15", dateTo: "2026-01-15", pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(invoiceIds.riyadh2330);
    expect(ids).not.toContain(invoiceIds.nextDay0030);
  });

  it("dateFrom/dateTo range filters correctly on the invoice date", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ dateFrom: "2026-02-01", dateTo: "2026-02-28", pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([invoiceIds.paid, invoiceIds.partiallyPaidByCredit, invoiceIds.unpaid]));
    expect(ids).not.toContain(invoiceIds.riyadh2330);
    expect(ids).not.toContain(invoiceIds.zatcaSent);
  });

  it("q matches invoice number partially", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ q: "1003" }));
    expect(result.items.map((i) => i.id)).toEqual([invoiceIds.paid]);
  });

  it("q matches customer name partially, case-insensitively", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ q: "الأفق", pageSize: "200" }));
    expect(result.items.every((i) => i.customerId === customerAId)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("q matches customerReference partially", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ q: "PO-777" }));
    expect(result.items.map((i) => i.id)).toEqual([invoiceIds.paid]);
  });

  it("amountMin/amountMax filters on grand total inclusively", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ amountMin: "400", amountMax: "500", pageSize: "200" }));
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([invoiceIds.paid, invoiceIds.zatcaSent, invoiceIds.zatcaSentWithNotes]));
    expect(ids).not.toContain(invoiceIds.unpaid);
  });

  it("customerId filters to only that customer's invoices", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ customerId: customerBId, pageSize: "200" }));
    expect(result.items.every((i) => i.customerId === customerBId)).toBe(true);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
  });

  it("invoiceType filters standard vs simplified", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ invoiceType: "simplified", pageSize: "200" }));
    expect(result.items.map((i) => i.id)).toEqual([invoiceIds.unpaid]);
  });

  it("paymentStatus filters by the derived payment status, matching invoiceCredits logic", async () => {
    const paid = await searchSalesInvoices(tenantId, parseQuery({ paymentStatus: "مسددة", pageSize: "200" }));
    expect(paid.items.map((i) => i.id)).toContain(invoiceIds.paid);

    const partial = await searchSalesInvoices(tenantId, parseQuery({ paymentStatus: "مسددة جزئياً", pageSize: "200" }));
    expect(partial.items.map((i) => i.id)).toContain(invoiceIds.partiallyPaidByCredit);

    const unpaid = await searchSalesInvoices(tenantId, parseQuery({ paymentStatus: "غير مسددة", pageSize: "200" }));
    expect(unpaid.items.map((i) => i.id)).toContain(invoiceIds.unpaid);
    expect(unpaid.items.map((i) => i.id)).not.toContain(invoiceIds.paid);
  });

  it("zatcaStatus filter reproduces the 4-way UI grouping (sent / sent_with_notes)", async () => {
    const sent = await searchSalesInvoices(tenantId, parseQuery({ zatcaStatus: "sent", pageSize: "200" }));
    expect(sent.items.map((i) => i.id)).toContain(invoiceIds.zatcaSent);
    expect(sent.items.map((i) => i.id)).not.toContain(invoiceIds.zatcaSentWithNotes);

    const sentWithNotes = await searchSalesInvoices(tenantId, parseQuery({ zatcaStatus: "sent_with_notes", pageSize: "200" }));
    expect(sentWithNotes.items.map((i) => i.id)).toEqual([invoiceIds.zatcaSentWithNotes]);

    const notApplicable = await searchSalesInvoices(tenantId, parseQuery({ zatcaStatus: "not_applicable", pageSize: "200" }));
    expect(notApplicable.items.map((i) => i.id)).toContain(invoiceIds.unpaid);
  });

  it("combined filters (dateFrom+dateTo+customerId+amountMin) narrow correctly", async () => {
    const result = await searchSalesInvoices(
      tenantId,
      parseQuery({ dateFrom: "2026-02-01", dateTo: "2026-02-28", customerId: customerBId, amountMin: "600", pageSize: "200" }),
    );
    expect(result.items.map((i) => i.id)).toEqual([invoiceIds.partiallyPaidByCredit]);
  });

  it("sorts by grandTotal ascending", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ customerId: customerAId, sortBy: "grandTotal", sortDir: "asc", pageSize: "200" }));
    const totals = result.items.map((i) => Number(i.grandTotal));
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it("default sort is date descending then invoiceNumber descending", async () => {
    const result = await searchSalesInvoices(tenantId, parseQuery({ customerId: customerAId, pageSize: "200" }));
    for (let i = 1; i < result.items.length; i++) {
      const prev = result.items[i - 1];
      const curr = result.items[i];
      const prevTime = new Date(prev.date).getTime();
      const currTime = new Date(curr.date).getTime();
      expect(prevTime >= currTime).toBe(true);
      if (prevTime === currTime) {
        expect(prev.invoiceNumber >= curr.invoiceNumber).toBe(true);
      }
    }
  });

  it("pagination totalCount is correct and stable across pages, with no duplicate/skipped rows", async () => {
    const pageSize = 15;
    const page1 = await searchSalesInvoices(tenantId, parseQuery({ customerId: customerAId, pageSize: String(pageSize), page: "1" }));
    const page2 = await searchSalesInvoices(tenantId, parseQuery({ customerId: customerAId, pageSize: String(pageSize), page: "2" }));

    expect(page1.totalCount).toBe(page2.totalCount);
    expect(page1.items.length).toBe(pageSize);
    const allIds = [...page1.items.map((i) => i.id), ...page2.items.map((i) => i.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("summary reflects the FULL filtered set, not just the current page", async () => {
    // dateTo يستبعد عمداً فواتير summaryDraft/summaryPending/summaryPosted (2026-05-01) — تلك
    // مخصَّصة لاختبار "الإجمالي يقتصر على المرحّلة فقط" أدناه؛ بقاء هذا الاختبار على فواتير مرحّلة
    // بالكامل فقط يُبقي التكافؤ summary.count === totalCount صحيحاً كما كان.
    const pageSize = "15";
    const page1 = await searchSalesInvoices(tenantId, parseQuery({ customerId: customerAId, dateTo: "2026-04-30", pageSize, page: "1" }));
    const fullPage = await searchSalesInvoices(tenantId, parseQuery({ customerId: customerAId, dateTo: "2026-04-30", pageSize: "200", page: "1" }));

    expect(page1.summary.count).toBe(fullPage.summary.count);
    expect(page1.summary.count).toBe(page1.totalCount);
    expect(page1.items.length).toBeLessThan(page1.summary.count);
    expect(Number(page1.summary.grandTotal)).toBeCloseTo(Number(fullPage.summary.grandTotal), 2);
    expect(Number(page1.summary.netTotal) + Number(page1.summary.vatTotal)).toBeCloseTo(Number(page1.summary.grandTotal), 1);
  });

  it("summary is restricted to POSTED invoices only, even with a draft and a pending invoice in the result set and no posting-status filter applied", async () => {
    const result = await searchSalesInvoices(
      tenantId,
      parseQuery({ dateFrom: "2026-05-01", dateTo: "2026-05-01", pageSize: "200" }),
    );

    // القائمة المُرقَّمة نفسها تعرض الثلاث فواتير كما هي (بلا فلتر حالة ترحيل) — لا تغيير هنا.
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([invoiceIds.summaryDraft, invoiceIds.summaryPending, invoiceIds.summaryPosted]));
    expect(result.totalCount).toBe(3);

    // لكن الإجمالي (summary) يقتصر على المرحّلة فقط: فاتورة واحدة بقيمة 900، لا الثلاث معاً (2000).
    expect(result.summary.count).toBe(1);
    expect(Number(result.summary.grandTotal)).toBeCloseTo(900, 2);
    expect(Number(result.summary.netTotal) + Number(result.summary.vatTotal)).toBeCloseTo(900, 1);
  });

  it("summary ignores the user's posting-status filter entirely and always reflects posted totals for the other active filters", async () => {
    const draftFiltered = await searchSalesInvoices(
      tenantId,
      parseQuery({ dateFrom: "2026-05-01", dateTo: "2026-05-01", status: "draft", pageSize: "200" }),
    );
    // القائمة تعرض فقط المسودة (فلتر المستخدم صريح لحالة الترحيل)، لكن الإجمالي يتجاهل ذلك الفلتر
    // تماماً ويستمر بعرض فاتورة summaryPosted المرحّلة (900) لنفس نطاق التاريخ — لا صفراً، ولا قيمة
    // المسودة المعروضة في القائمة بأي حال.
    expect(draftFiltered.items.map((i) => i.id)).toEqual([invoiceIds.summaryDraft]);
    expect(draftFiltered.summary.count).toBe(1);
    expect(Number(draftFiltered.summary.grandTotal)).toBeCloseTo(900, 2);
  });

  it("rejects an out-of-range pageSize before hitting the database", () => {
    const parsed = searchSalesInvoicesQuerySchema.safeParse({ companyId, pageSize: "30" });
    expect(parsed.success).toBe(false);
  });

  it("rejects dateFrom after dateTo before hitting the database", () => {
    const parsed = searchSalesInvoicesQuerySchema.safeParse({ companyId, dateFrom: "2026-03-01", dateTo: "2026-01-01" });
    expect(parsed.success).toBe(false);
  });
});
