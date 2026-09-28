import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * أعمار الذمم كما في نهاية الشهر، عبر مسارات HTTP الحقيقية على Postgres فعلي. كل حالة هنا تدور حول حدث يقع *بعد*
 * الشهر المُبلَّغ عنه ولا يجوز أن يغيّره:
 * - مدينة: سند قبض مؤرَّخ في سبتمبر ومُخصَّص لفاتورة يونيو لا يُنقِص ذمة يونيو؛ مرتجع مرتبط بالفاتورة داخل الشهر يُنقِصها؛
 *   تخصيص قديم بلا وقت تسجيل يُعتبَر بتاريخ سنده؛ الإجمالي = رصيد العميل في الأستاذ.
 * - دائنة: السداد (قيد يومية على حساب المورد) يُنقِص الذمة من تاريخه فقط، ويُوزَّع على الفواتير من الأحدث للأقدم —
 *   كان التقرير يجمع كل فاتورة مرحّلة ولا يطرح أي سداد إطلاقاً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `aging-asof-${stamp}@example.com`;
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
const acc: Record<string, string> = {};
let customerId = "";
let otherCustomerId = "";
let supplierId = "";
let supplierAccountId = "";
let thirdCustomerId = "";
let secondSupplierId = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function salesInvoice(forCustomer: string, date: string, gross: number) {
  const res = await call("POST", "/sales-invoices", {
    companyId, customerId: forCustomer, date, post: true,
    lines: [{ accountId: acc.revenue, description: "بند", quantity: 1, unitPrice: gross, priceIncludesVat: true }],
  });
  expect(res.status, res.text).toBe(201);
  return (res.body.id ?? res.body.invoice?.id) as string;
}

async function purchaseInvoice(date: string, net: number) {
  const created = await call("POST", "/purchase-invoices", {
    companyId, supplierId, date, lines: [{ accountId: acc.expense, description: "مشتريات", quantity: 1, unitPrice: net, priceIncludesVat: true }],
  });
  expect(created.status, created.text).toBe(201);
  if (created.body.status !== "posted") expect((await call("POST", `/purchase-invoices/${created.body.id}/post`)).status).toBe(200);
  return prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: created.body.id } });
}

async function purchaseInvoice2(date: string, net: number) {
  const created = await call("POST", "/purchase-invoices", {
    companyId, supplierId: secondSupplierId, date, lines: [{ accountId: acc.expense, description: "مشتريات", quantity: 1, unitPrice: net, priceIncludesVat: true }],
  });
  expect(created.status, created.text).toBe(201);
  if (created.body.status !== "posted") expect((await call("POST", `/purchase-invoices/${created.body.id}/post`)).status).toBe(200);
  return created.body as { id: string };
}

async function receivablesRow(asOf: string, id = customerId) {
  const res = await call("GET", `/sales-reports/aging?companyId=${companyId}&asOf=${asOf}`);
  expect(res.status, res.text).toBe(200);
  return res.body.find((r: { customerId: string }) => r.customerId === id);
}

async function payablesRow(asOf: string) {
  const res = await call("GET", `/purchase-reports/aging?companyId=${companyId}&asOf=${asOf}`);
  expect(res.status, res.text).toBe(200);
  return res.body.find((r: { supplierId: string }) => r.supplierId === supplierId);
}

async function monthly(month: string) {
  const res = await call("GET", `/reports/comprehensive-monthly?companyId=${companyId}&month=${month}`);
  expect(res.status, res.text).toBe(200);
  return res.body;
}

describe("aging as at a date (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `أعمار الذمم ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    acc.revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    acc.expense = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "expense", isPosting: true } })).id;
    acc.cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
    customerId = (await call("POST", "/customers", { companyId, name: "عميل الأعمار" })).body.id;
    otherCustomerId = (await call("POST", "/customers", { companyId, name: "عميل التخصيص القديم" })).body.id;
    thirdCustomerId = (await call("POST", "/customers", { companyId, name: "عميل النقل والاسترداد" })).body.id;
    secondSupplierId = (await call("POST", "/suppliers", { companyId, name: "مورد المرتجعات" })).body.id;
    const supplier = await call("POST", "/suppliers", { companyId, name: "مورد الأعمار" });
    expect(supplier.status, supplier.text).toBe(201);
    supplierId = supplier.body.id;
    supplierAccountId = (await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } })).accountId!;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.receipt.deleteMany({ where: { tenantId } });
    await prisma.salesReturn.deleteMany({ where: { tenantId } });
    await prisma.salesDebitNote.deleteMany({ where: { tenantId } });
    await prisma.purchaseReturn.deleteMany({ where: { tenantId } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId } });
    await prisma.purchaseInvoice.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email } });
  });

  it("receivables: a September receipt allocated to a June invoice does not reduce June's aging", async () => {
    const june = await salesInvoice(customerId, "2026-06-10T09:00:00.000Z", 1150);
    const receipt = await call("POST", "/receipts", {
      companyId, customerId, date: "2026-09-05T09:00:00.000Z", method: "cash", allocations: [{ invoiceId: june, amount: 1150 }],
    });
    expect(receipt.status, receipt.text).toBe(201);

    const atJune = await receivablesRow("2026-06-30");
    expect(atJune.total).toBe(1150);
    expect(atJune.current).toBe(1150);
    expect(atJune.unallocated).toBe(0);
    expect((await monthly("2026-06")).receivables.total).toBe(1150);

    // اليوم (بعد السند): لا ذمة
    const now = await call("GET", `/sales-reports/aging?companyId=${companyId}`);
    expect(now.body.find((r: { customerId: string }) => r.customerId === customerId)).toBeUndefined();
    // سبتمبر: السند داخل الشهر يُنقِصها
    expect((await monthly("2026-09")).receivables.total).toBe(0);
  });

  it("receivables: an allocation moved to another invoice after the month leaves the month as it was", async () => {
    const julyX = await salesInvoice(thirdCustomerId, "2026-07-05T09:00:00.000Z", 575);
    const julyY = await salesInvoice(thirdCustomerId, "2026-07-06T09:00:00.000Z", 575);
    const receipt = await call("POST", "/receipts", {
      companyId, customerId: thirdCustomerId, date: "2026-07-20T09:00:00.000Z", method: "cash", allocations: [{ invoiceId: julyX, amount: 575 }],
    });
    expect(receipt.status, receipt.text).toBe(201);
    const before = await receivablesRow("2026-07-31", thirdCustomerId);
    expect(before.current).toBe(575); // Y مفتوحة، X مسدَّدة
    expect(before.unallocated).toBe(0);

    // سبتمبر: يُفكّ من X ويُخصَّص لـY — نهاية يوليو كما كانت (X مسدَّدة، Y مفتوحة)
    expect((await call("DELETE", `/receipts/${receipt.body.id}/allocations/${julyX}`)).status).toBe(200);
    expect((await call("POST", `/receipts/${receipt.body.id}/allocations`, { invoiceId: julyY, amount: 575 })).status).toBe(201);
    expect(await receivablesRow("2026-07-31", thirdCustomerId)).toEqual(before);
    // واليوم: Y مسدَّدة وX مفتوحة
    const now = await call("GET", `/sales-reports/aging?companyId=${companyId}`);
    const today = now.body.find((r: { customerId: string }) => r.customerId === thirdCustomerId);
    expect(today.total).toBe(575);
    expect(today.unallocated).toBe(0);
  });

  it("receivables: a return refunded in cash and a debit note charged in cash don't move the receivable's age buckets", async () => {
    const inv = await salesInvoice(thirdCustomerId, "2026-08-02T09:00:00.000Z", 1150);
    const line = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: inv } });
    const before = await receivablesRow("2026-08-31", thirdCustomerId);
    const ret = await call("POST", "/sales-returns", {
      companyId, customerId: thirdCustomerId, relatedInvoiceId: inv, date: "2026-08-20T09:00:00.000Z", refundMethod: "cash", reason: "استرداد نقدي",
      lines: [{ originalInvoiceLineId: line.id, accountId: acc.revenue, description: "مرتجع", quantity: 0.2, unitPrice: 1150, priceIncludesVat: true }],
    });
    expect(ret.status, ret.text).toBe(201);
    if (ret.body.status !== "posted") expect((await call("POST", `/sales-returns/${ret.body.id}/post`)).status).toBe(200);
    const dn = await call("POST", "/sales-debit-notes", {
      companyId, customerId: thirdCustomerId, date: "2026-08-21T09:00:00.000Z", chargeMethod: "cash", reason: "رسوم",
      lines: [{ accountId: acc.revenue, description: "رسوم", quantity: 1, unitPrice: 115, priceIncludesVat: true }],
    });
    expect(dn.status, dn.text).toBe(201);
    if (dn.body.status !== "posted") expect((await call("POST", `/sales-debit-notes/${dn.body.id}/post`)).status).toBe(200);

    const after = await receivablesRow("2026-08-31", thirdCustomerId);
    expect(after).toEqual(before);
  });

  it("receivables: an old allocation with no recorded time counts from its receipt's date", async () => {
    const inv = await salesInvoice(otherCustomerId, "2026-05-10T09:00:00.000Z", 230);
    const receipt = await call("POST", "/receipts", {
      companyId, customerId: otherCustomerId, date: "2026-05-20T09:00:00.000Z", method: "cash", allocations: [{ invoiceId: inv, amount: 230 }],
    });
    expect(receipt.status, receipt.text).toBe(201);
    await prisma.receiptAllocation.updateMany({ where: { receiptId: receipt.body.id }, data: { createdAt: null } });
    expect(await receivablesRow("2026-05-31", otherCustomerId)).toBeUndefined();
    expect((await receivablesRow("2026-05-15", otherCustomerId)).current).toBe(230);
  });

  it("receivables: a return against the invoice reduces it from the return's date only", async () => {
    const aug = await salesInvoice(customerId, "2026-08-03T09:00:00.000Z", 1150);
    const line = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: aug } });
    const ret = await call("POST", "/sales-returns", {
      companyId, customerId, relatedInvoiceId: aug, date: "2026-08-25T09:00:00.000Z", refundMethod: "account", reason: "مرتجع جزئي",
      lines: [{ originalInvoiceLineId: line.id, accountId: acc.revenue, description: "مرتجع", quantity: 0.2, unitPrice: 1150, priceIncludesVat: true }],
    });
    expect(ret.status, ret.text).toBe(201);
    if (ret.body.status !== "posted") expect((await call("POST", `/sales-returns/${ret.body.id}/post`)).status).toBe(200);

    const before = await receivablesRow("2026-08-20");
    const after = await receivablesRow("2026-08-31");
    expect(after.current).toBe(before.current - 230);
    expect(after.total).toBe(before.total - 230);
    expect(after.unallocated).toBe(before.unallocated);
  });

  it("payables: payments reduce the balance from their date only, matched to the newest invoices first", async () => {
    await purchaseInvoice("2026-05-01T09:00:00.000Z", 1000);
    await purchaseInvoice("2026-06-15T09:00:00.000Z", 500);

    // يونيو: لا سداد بعد
    const june = await payablesRow("2026-06-30");
    expect(june.total).toBe(1500);
    expect(june.current).toBe(500); // 15 يوماً
    expect(june.d30 + june.d60).toBe(1000); // 60 يوماً
    expect(june.unallocated).toBe(0);

    // سداد 1000 في يوليو بقيد يومية على حساب المورد
    const payment = await call("POST", "/journal-entries", {
      companyId, date: "2026-07-10T09:00:00.000Z", memo: "سداد مورد", post: true,
      lines: [{ accountId: supplierAccountId, debit: 1000, credit: 0, supplierId }, { accountId: acc.cash, debit: 0, credit: 1000 }],
    });
    expect(payment.status, payment.text).toBe(201);

    // يونيو لا يتغيّر بسداد لاحق
    expect((await payablesRow("2026-06-30")).total).toBe(1500);
    expect((await monthly("2026-06")).payables.total).toBe(1500);

    // يوليو: الباقي 500 هو فاتورة يونيو (الأحدث)، وفاتورة مايو مسدَّدة — كان التقرير يعرض 1500 دائماً
    const july = await payablesRow("2026-07-31");
    expect(july.total).toBe(500);
    expect(july.d30).toBe(500); // 46 يوماً من 15 يونيو
    expect(july.d60 + july.d90).toBe(0);
    expect((await monthly("2026-07")).payables.total).toBe(500);
    expect((await monthly("2026-07")).payables.aging.d30to60).toBe(500);
  });

  it("payables: a return linked to an invoice reduces that invoice before the balance is matched newest-first", async () => {
    const may = await purchaseInvoice2("2026-05-03T09:00:00.000Z", 1000);
    const aug = await purchaseInvoice2("2026-08-03T09:00:00.000Z", 1000);
    const ret = await call("POST", "/purchase-returns", {
      companyId, supplierId: secondSupplierId, relatedInvoiceId: aug.id, date: "2026-08-10T09:00:00.000Z",
      lines: [{ accountId: acc.expense, description: "مرتجع", quantity: 1, unitPrice: 500, priceIncludesVat: true }],
    });
    expect(ret.status, ret.text).toBe(201);
    if (ret.body.status !== "posted") expect((await call("POST", `/purchase-returns/${ret.body.id}/post`)).status).toBe(200);
    void may;

    const res = await call("GET", `/purchase-reports/aging?companyId=${companyId}&asOf=2026-08-31`);
    const row = res.body.find((r: { supplierId: string }) => r.supplierId === secondSupplierId);
    expect(row.total).toBe(1500);
    expect(row.current).toBe(500); // أغسطس بعد المرتجع
    expect(row.d90).toBe(1000); // مايو كاملة — لا يُحمَّل المرتجع عليها
    expect(row.unallocated).toBe(0);
  });

  it("payables: an overpayment shows as a negative, unallocated balance rather than vanishing", async () => {
    const pay = await call("POST", "/journal-entries", {
      companyId, date: "2026-08-10T09:00:00.000Z", memo: "دفعة مقدَّمة", post: true,
      lines: [{ accountId: supplierAccountId, debit: 700, credit: 0, supplierId }, { accountId: acc.cash, debit: 0, credit: 700 }],
    });
    expect(pay.status, pay.text).toBe(201);
    const aug = await payablesRow("2026-08-31");
    expect(aug.total).toBe(-200);
    expect(aug.unallocated).toBe(-200);
    expect(aug.current + aug.d30 + aug.d60 + aug.d90).toBe(0);
  });
});
