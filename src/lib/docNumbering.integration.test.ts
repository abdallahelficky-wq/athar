import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { createApp } from "../app";
import { register } from "../modules/auth/auth.service";

/**
 * أول ترقيم لنوع مستند في شركة تحت طلبات متزامنة — على Postgres فعلي، عبر HTTP. قبل الإصلاح كان reserveDocumentNumber
 * يُنشئ صف document_numbering_settings بـupsert في Prisma (قراءة ثم إدراج، ليس ذرّياً): أول مستندين متزامنين من نوع واحد
 * لا يجد أيٌّ منهما الصف، فيُدرجانه معاً ويسقط أحدهما بخطأ قيد فريد (500). شركة بلا ربط زاتكا: المستند يُرحَّل مباشرة،
 * فالحالة المشتركة الوحيدة بين الطلبات هي صف الترقيم.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailPrefix = `doc-numbering-race-${stamp}`;
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let revenueId = "";
let customerId = "";
let invoiceId = "";
let invoiceLineId = "";

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, text };
}

const creditNote = () => api("POST", "/sales-returns", {
  companyId, customerId, relatedInvoiceId: invoiceId, date: "2026-10-02T00:00:00.000Z", reason: "مرتجع جزئي",
  lines: [{ originalInvoiceLineId: invoiceLineId, accountId: revenueId, quantity: 0.1, unitPrice: 100 }],
});
const debitNote = () => api("POST", "/sales-debit-notes", {
  companyId, customerId, relatedInvoiceId: invoiceId, date: "2026-10-02T00:00:00.000Z", reason: "فرق سعر",
  lines: [{ accountId: revenueId, description: "فرق", quantity: 1, unitPrice: 11.5 }],
});

describe("first document numbering under concurrent requests (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `ترقيم متزامن ${stamp}`, businessActivity: "retail", name: "المالك", email: `${emailPrefix}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    revenueId = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    const c = await api("POST", "/customers", { companyId, name: "عميل", customerType: "individual" });
    expect(c.status, c.text).toBe(201);
    customerId = c.body.id;
    const inv = await api("POST", "/sales-invoices", {
      companyId, customerId, date: "2026-10-01T00:00:00.000Z", post: true,
      lines: [{ accountId: revenueId, description: "خدمة", quantity: 10, unitPrice: 100, priceIncludesVat: true }],
    });
    expect(inv.status, inv.text).toBe(201);
    invoiceId = inv.body.id;
    invoiceLineId = (await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId } })).id;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.salesReturn.deleteMany({ where: { tenantId } });
    await prisma.salesDebitNote.deleteMany({ where: { tenantId } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId } });
    await prisma.documentNumberingSettings.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email: { startsWith: emailPrefix } } });
  });

  it("the very first debit notes of a company, sent at once, all succeed with distinct consecutive numbers and one settings row", async () => {
    // إشعارات المدين لا تقفل الفاتورة الأصلية (بخلاف المردود — validateLinkedReturn)، فتصل إلى الترقيم متزامنة فعلاً
    expect(await prisma.documentNumberingSettings.count({ where: { companyId, docType: "sales_debit_note" } })).toBe(0);
    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => debitNote()));
    for (const r of results) expect(r.status, r.text).toBe(201);
    const numbers = (await prisma.salesDebitNote.findMany({ where: { companyId }, select: { debitNoteNumber: true } })).map((d) => d.debitNoteNumber).sort();
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => `DBN-${String(i + 1).padStart(5, "0")}`));
    const settings = await prisma.documentNumberingSettings.findMany({ where: { companyId, docType: "sales_debit_note" } });
    expect(settings).toHaveLength(1);
    expect(settings[0].nextSeq).toBe(N + 1);
  }, 120_000);

  it("the very first invoices of a brand-new company, sent at once, all succeed with distinct consecutive numbers", async () => {
    const co = await api("POST", "/companies", { name: `شركة جديدة ${stamp}`, businessActivity: "retail" });
    expect(co.status, co.text).toBe(201);
    const newCompanyId = co.body.id as string;
    const rev = (await prisma.account.findFirstOrThrow({ where: { companyId: newCompanyId, type: "revenue", isPosting: true } })).id;
    const cust = await api("POST", "/customers", { companyId: newCompanyId, name: "عميل", customerType: "individual" });
    expect(cust.status, cust.text).toBe(201);
    expect(await prisma.documentNumberingSettings.count({ where: { companyId: newCompanyId } })).toBe(0);
    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => api("POST", "/sales-invoices", {
      companyId: newCompanyId, customerId: cust.body.id, date: "2026-10-01T00:00:00.000Z", post: true,
      lines: [{ accountId: rev, description: "خدمة", quantity: 1, unitPrice: 115, priceIncludesVat: true }],
    })));
    for (const r of results) expect(r.status, r.text).toBe(201);
    const numbers = (await prisma.salesInvoice.findMany({ where: { companyId: newCompanyId }, select: { invoiceNumber: true } })).map((r) => r.invoiceNumber).sort();
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => `INV-${String(i + 1).padStart(5, "0")}`));
    expect(await prisma.documentNumberingSettings.count({ where: { companyId: newCompanyId, docType: "sales_invoice" } })).toBe(1);
  }, 120_000);

  it("never overwrites an existing settings row: a company's own prefix and counter are kept", async () => {
    // إعدادات خصّصتها الشركة مسبقاً (أو هيّأتها هجرة الترقيم): بادئة مختلفة وعدّاد يبدأ من 48
    await prisma.documentNumberingSettings.create({
      data: { tenantId, companyId, docType: "sales_return", prefix: "CN/{year}/", digits: 4, resetMode: "continuous", nextSeq: 48 },
    });
    const N = 4;
    const results = await Promise.all(Array.from({ length: N }, () => creditNote()));
    for (const r of results) expect(r.status, r.text).toBe(201);
    const year = new Date().getFullYear();
    const numbers = (await prisma.salesReturn.findMany({ where: { companyId }, select: { returnNumber: true } })).map((r) => r.returnNumber).sort();
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => `CN/${year}/${String(48 + i).padStart(4, "0")}`));
    const settings = await prisma.documentNumberingSettings.findUniqueOrThrow({ where: { companyId_docType: { companyId, docType: "sales_return" } } });
    expect(settings).toMatchObject({ prefix: "CN/{year}/", digits: 4, nextSeq: 48 + N });
  }, 120_000);
});
