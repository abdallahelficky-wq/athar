import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { env } from "../../config/env";
import { register } from "../auth/auth.service";

/**
 * الشيكات عبر HTTP الحقيقي على Postgres:
 * - بلا حساب أوراق قبض في الإعدادات ⇒ التسجيل مرفوض؛
 * - شيك وارد من عميل: التسجيل (أوراق القبض/حساب العميل التفصيلي) ثم التحصيل (البنك/أوراق القبض) بقيود من الخادم؛
 * - شيك صادر لمورد: التسجيل ثم الارتداد (أوراق الدفع/المورد)، والتراجع يعيده قائماً ثم يحذفه مع قيوده؛
 * - قيد الشيك مقفل في شاشة القيود (فك الترحيل مرفوض)؛ مستأجر آخر لا يرى الشيك.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailA = `cheques-a-${stamp}@example.com`;
const emailB = `cheques-b-${stamp}@example.com`;
const password = "Str0ng-Pass!";
const tenantIds: string[] = [];
let server: Server;
let baseUrl = "";

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function entryLines(journalEntryId: string) {
  const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId } });
  return lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) }));
}

describe("cheques (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.chequeEvent.deleteMany({ where: { tenantId } });
      await prisma.cheque.deleteMany({ where: { tenantId } });
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  });

  it("runs received and issued cheques through their lifecycle with entries", async () => {
    const a = await register({ tenantName: "مستأجر الشيكات", businessActivity: "retail", name: "المالك", email: emailA, password });
    tenantIds.push(a.tenant.id);
    const b = await register({ tenantName: "مستأجر آخر", businessActivity: "retail", name: "آخر", email: emailB, password });
    tenantIds.push(b.tenant.id);
    const token = a.accessToken;
    const company = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    const bank = await prisma.account.findFirstOrThrow({ where: { companyId: company.id, isPosting: true, isBankOrCash: true } });
    const notesReceivable = await prisma.account.create({ data: { tenantId: a.tenant.id, companyId: company.id, name: "أوراق قبض", type: "asset", code: `81${String(stamp).slice(-5)}`, level: 4, isPosting: true } });
    const notesPayable = await prisma.account.create({ data: { tenantId: a.tenant.id, companyId: company.id, name: "أوراق دفع", type: "liability", code: `82${String(stamp).slice(-5)}`, level: 4, isPosting: true } });

    const customer = await call("POST", "/customers", token, { companyId: company.id, name: "عميل الشيكات" });
    expect(customer.status).toBe(201);
    const supplier = await call("POST", "/suppliers", token, { companyId: company.id, name: "مورد الشيكات" });
    expect(supplier.status).toBe(201);
    const customerAccountId = (await prisma.customer.findUniqueOrThrow({ where: { id: customer.body.id } })).accountId!;
    const supplierAccountId = (await prisma.supplier.findUniqueOrThrow({ where: { id: supplier.body.id } })).accountId!;

    const received = { companyId: company.id, direction: "received", chequeNumber: "R-100", issueDate: "2026-05-01", dueDate: "2026-05-20", amount: 2500, customerId: customer.body.id };
    expect((await call("POST", "/cheques", token, received)).status).toBe(400); // بلا حساب أوراق القبض

    expect((await call("PUT", "/cheques/settings", token, { companyId: company.id, chequesReceivableAccountId: notesReceivable.id, chequesPayableAccountId: notesPayable.id })).status).toBe(200);
    expect((await call("PUT", "/cheques/settings", token, { companyId: company.id, chequesReceivableAccountId: bank.id })).status).toBe(400); // البنك ليس حساب أوراق قبض

    const rc = await call("POST", "/cheques", token, received);
    expect(rc.status).toBe(201);
    expect(rc.body.status).toBe("pending");
    expect(await entryLines(rc.body.events[0].journalEntry.id)).toEqual(expect.arrayContaining([
      { accountId: notesReceivable.id, debit: 2500, credit: 0 },
      { accountId: customerAccountId, debit: 0, credit: 2500 },
    ]));

    const cleared = await call("POST", `/cheques/${rc.body.id}/clear`, token, { date: "2026-05-21", bankAccountId: bank.id });
    expect(cleared.status).toBe(200);
    expect(cleared.body.status).toBe("cleared");
    expect(await entryLines(cleared.body.events[1].journalEntry.id)).toEqual(expect.arrayContaining([
      { accountId: bank.id, debit: 2500, credit: 0 },
      { accountId: notesReceivable.id, debit: 0, credit: 2500 },
    ]));
    expect((await call("POST", `/cheques/${rc.body.id}/bounce`, token, { date: "2026-05-22" })).status).toBe(409); // ليس قائماً

    // قيد الشيك مقفل في شاشة القيود
    const unpost = await call("POST", `/journal-entries/${cleared.body.events[1].journalEntry.id}/unpost`, token, { pin: env.defaultUnlockPin });
    expect(unpost.status).toBe(400);
    expect(unpost.body.error).toMatch(/شاشة الشيكات/);

    // شيك صادر: تسجيل ثم ارتداد ثم تراجعان
    const ic = await call("POST", "/cheques", token, { companyId: company.id, direction: "issued", chequeNumber: "I-7", issueDate: "2026-06-01", dueDate: "2026-06-30", amount: 900, supplierId: supplier.body.id });
    expect(ic.status).toBe(201);
    const bounced = await call("POST", `/cheques/${ic.body.id}/bounce`, token, { date: "2026-06-30", note: "رصيد غير كافٍ" });
    expect(bounced.body.status).toBe("bounced");
    expect(await entryLines(bounced.body.events[1].journalEntry.id)).toEqual(expect.arrayContaining([
      { accountId: notesPayable.id, debit: 900, credit: 0 },
      { accountId: supplierAccountId, debit: 0, credit: 900 },
    ]));
    const bounceEntryId = bounced.body.events[1].journalEntry.id;
    const undone = await call("POST", `/cheques/${ic.body.id}/undo`, token);
    expect(undone.status).toBe(200);
    expect(undone.body.status).toBe("pending");
    expect(await prisma.journalEntry.findUnique({ where: { id: bounceEntryId } })).toBeNull();
    const registerEntryId = undone.body.events[0].journalEntry.id;
    expect((await call("POST", `/cheques/${ic.body.id}/undo`, token)).status).toBe(204);
    expect(await prisma.cheque.findUnique({ where: { id: ic.body.id } })).toBeNull();
    expect(await prisma.journalEntry.findUnique({ where: { id: registerEntryId } })).toBeNull();

    // عزل المستأجر
    expect((await call("GET", `/cheques/${rc.body.id}`, b.accessToken)).status).toBe(404);
  });
});
