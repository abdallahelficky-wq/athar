import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * تخصيص سندات القبض عملية دفتر عملاء فقط، عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * - مبلغ السند وقيده المرحَّل (رقمه وأسطره) لا يتغيّران بأي إضافة أو فك تخصيص؛
 * - المتاح للتخصيص هو غير المخصَّص من السند فقط، ويُرفَض تجاوزه (النقد الإضافي سند جديد)؛
 * - فك آخر تخصيص مسموح ويعيد المبلغ لغير المخصَّص؛
 * - كل تغيير يكتب صف تدقيق بالمستخدم والسند والتخصيصات قبل وبعد والمبالغ، ويُختَم التخصيص بوقته ومنشئه؛
 * - تخصيصان متزامنان لا يتجاوزان معاً الرصيد غير المخصَّص.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `receipt-alloc-${stamp}@example.com`;
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let userId = "";
let customerId = "";
let otherCustomerId = "";
let revenueId = "";

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

async function invoice(forCustomer: string, gross: number) {
  const res = await call("POST", "/sales-invoices", {
    companyId, customerId: forCustomer, date: "2026-09-01T09:00:00.000Z", post: true,
    lines: [{ accountId: revenueId, description: "بند", quantity: 1, unitPrice: gross, priceIncludesVat: true }],
  });
  expect(res.status, res.text).toBe(201);
  return prisma.salesInvoice.findUniqueOrThrow({ where: { id: res.body.id ?? res.body.invoice?.id } });
}

async function ledgerOf(journalEntryId: string) {
  const entry = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: journalEntryId },
    include: { lines: { select: { id: true, accountId: true, debit: true, credit: true }, orderBy: { id: "asc" } } },
  });
  return { id: entry.id, entryNumber: entry.entryNumber, updatedAt: entry.updatedAt.toISOString(), lines: entry.lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })) };
}

async function receiptState(id: string) {
  const list = await call("GET", `/receipts?companyId=${companyId}&customerId=${customerId}`);
  expect(list.status).toBe(200);
  return list.body.find((r: { id: string }) => r.id === id);
}

describe("receipt allocations are sub-ledger only (integration)", () => {
  let receiptId = "";
  let entryBefore: Awaited<ReturnType<typeof ledgerOf>>;
  let invA: { id: string; invoiceNumber: string };
  let invB: { id: string; invoiceNumber: string };
  let invC: { id: string; invoiceNumber: string };

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `تخصيص السندات ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    userId = r.user.id;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    revenueId = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    customerId = (await call("POST", "/customers", { companyId, name: "عميل التخصيص" })).body.id;
    otherCustomerId = (await call("POST", "/customers", { companyId, name: "عميل آخر" })).body.id;
    invA = await invoice(customerId, 1150);
    invB = await invoice(customerId, 575);
    invC = await invoice(customerId, 575);

    const created = await call("POST", "/receipts", {
      companyId, customerId, date: "2026-09-02T09:00:00.000Z", method: "cash",
      allocations: [{ invoiceId: invA.id, amount: 1150 }],
    });
    expect(created.status, created.text).toBe(201);
    receiptId = created.body.id;
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId }, include: { allocations: true } });
    entryBefore = await ledgerOf(receipt.journalEntryId!);
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.receipt.deleteMany({ where: { tenantId } });
    await prisma.salesInvoice.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email } });
  });

  it("stamps the allocations a new receipt is created with", async () => {
    const [allocation] = await prisma.receiptAllocation.findMany({ where: { receiptId } });
    expect(allocation.createdByUserId).toBe(userId);
    expect(allocation.createdAt).not.toBeNull();
  });

  it("removing the last allocation frees the whole amount and leaves the receipt and its entry untouched", async () => {
    const res = await call("DELETE", `/receipts/${receiptId}/allocations/${invA.id}`);
    expect(res.status, res.text).toBe(200);
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(Number(receipt.totalAmount)).toBe(1150);
    expect(receipt.journalEntryId).toBe(entryBefore.id);
    expect(await ledgerOf(entryBefore.id)).toEqual(entryBefore);
    expect((await receiptState(receiptId)).unappliedAmount).toBe(1150);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "receipt.allocation_removed", entityId: receiptId } });
    expect(audit.userId).toBe(userId);
    expect(audit.companyId).toBe(companyId);
    expect(audit.metadata).toMatchObject({
      invoiceId: invA.id, invoiceNumber: invA.invoiceNumber, amount: 1150,
      before: [{ invoiceId: invA.id, amount: 1150 }], after: [], unappliedBefore: 0, unappliedAfter: 1150,
    });
  });

  it("allocates from the unapplied balance only, stamps who and when, and never touches the entry", async () => {
    const res = await call("POST", `/receipts/${receiptId}/allocations`, { invoiceId: invB.id, amount: 575 });
    expect(res.status, res.text).toBe(201);
    const allocation = await prisma.receiptAllocation.findFirstOrThrow({ where: { receiptId, invoiceId: invB.id } });
    expect(allocation.createdByUserId).toBe(userId);
    expect(allocation.createdAt).not.toBeNull();
    expect(Number((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).totalAmount)).toBe(1150);
    expect(await ledgerOf(entryBefore.id)).toEqual(entryBefore);
    expect((await receiptState(receiptId)).unappliedAmount).toBe(575);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "receipt.allocation_added", entityId: receiptId } });
    expect(audit.metadata).toMatchObject({ invoiceId: invB.id, amount: 575, before: [], after: [{ invoiceId: invB.id, amount: 575 }], unappliedBefore: 1150, unappliedAfter: 575 });
  });

  it("refuses to allocate beyond the unapplied balance, and changes nothing", async () => {
    const auditsBefore = await prisma.auditLog.count({ where: { tenantId, entityId: receiptId } });
    const res = await call("POST", `/receipts/${receiptId}/allocations`, { invoiceId: invA.id, amount: 600 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("575.00");
    expect(await prisma.receiptAllocation.count({ where: { receiptId, invoiceId: invA.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: receiptId } })).toBe(auditsBefore);
    expect(await ledgerOf(entryBefore.id)).toEqual(entryBefore);
  });

  it("refuses another customer's invoice and an unknown allocation", async () => {
    const foreign = await invoice(otherCustomerId, 115);
    expect((await call("POST", `/receipts/${receiptId}/allocations`, { invoiceId: foreign.id, amount: 100 })).status).toBe(400);
    expect((await call("DELETE", `/receipts/${receiptId}/allocations/${invC.id}`)).status).toBe(404);
  });

  it("two concurrent allocations cannot together exceed the unapplied balance", async () => {
    // غير المخصَّص الآن 575 — طلبان متزامنان كل منهما بالمبلغ كاملاً لفاتورتين مختلفتين: ينجح واحد فقط
    const [a, c] = await Promise.all([
      call("POST", `/receipts/${receiptId}/allocations`, { invoiceId: invA.id, amount: 575 }),
      call("POST", `/receipts/${receiptId}/allocations`, { invoiceId: invC.id, amount: 575 }),
    ]);
    expect([a.status, c.status].sort()).toEqual([201, 400]);
    const allocations = await prisma.receiptAllocation.findMany({ where: { receiptId } });
    expect(allocations.reduce((s, x) => s + Number(x.amount), 0)).toBe(1150);
    expect((await receiptState(receiptId)).unappliedAmount).toBe(0);
    expect(await ledgerOf(entryBefore.id)).toEqual(entryBefore);
  });
});
