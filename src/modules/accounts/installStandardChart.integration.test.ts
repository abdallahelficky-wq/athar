import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * تثبيت الشجرة القياسية لا يحذف دفاتر أبداً: يُرفَض (409) متى وُجد في نطاقه أي قيد أو مستند، مرحَّلاً
 * أو مسودة، ولا يتغيّر شيء — لا القيد ولا المستند ولا الحسابات.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `install-chart-${stamp}@example.com`;
let server: Server;
let baseUrl = "";
let tenantId = "";
let companyId = "";
let token = "";

async function install(body: unknown, lang = "ar") {
  const res = await fetch(`${baseUrl}/api/accounts/install-standard`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "accept-language": lang },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("install-standard never deletes books (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `تثبيت الشجرة ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const user = await prisma.user.update({ where: { id: r.user.id }, data: { role: "super_admin" } });
    token = signAccessToken({ sub: user.id, tenantId, role: "super_admin", companyScope: "all", readOnly: false });
  });

  afterAll(async () => {
    server?.close();
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email } });
  });

  it("refuses with 409 when the company holds a single draft journal entry, and changes nothing", async () => {
    const [cash, revenue] = await Promise.all([
      prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } }),
      prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } }),
    ]);
    const entry = await prisma.journalEntry.create({
      data: {
        tenantId, companyId, date: new Date(), status: "saved", entryNumber: `T-${stamp}`, sourceModule: "manual",
        lines: { create: [{ accountId: cash.id, debit: 10, credit: 0 }, { accountId: revenue.id, debit: 0, credit: 10 }] },
      },
    });
    const accountsBefore = await prisma.account.count({ where: { companyId } });

    for (const body of [{ companyId, confirmation: "INSTALL_STANDARD_CHART" }, { companyId: null, confirmation: "INSTALL_STANDARD_CHART" }]) {
      const res = await install(body);
      expect(res.status).toBe(409);
    }
    // الرسالة مترجمة كاملة بالإنجليزية للنطاقين (لا تبقى عربية)
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const enCompany = await install({ companyId, confirmation: "INSTALL_STANDARD_CHART" }, "en");
    expect(enCompany.body.error).toBe(
      `The standard chart can't be installed: company "${company.name}" holds journal entries or financial documents. Installing the chart is only available for an empty company, and it never deletes any books.`,
    );
    const enTenant = await install({ companyId: null, confirmation: "INSTALL_STANDARD_CHART" }, "en");
    expect(enTenant.body.error).toMatch(/^The standard chart can't be installed: the tenant's companies hold/);
    expect(await prisma.journalEntry.count({ where: { id: entry.id } })).toBe(1);
    expect(await prisma.journalEntryLine.count({ where: { journalEntryId: entry.id } })).toBe(2);
    expect(await prisma.account.count({ where: { companyId } })).toBe(accountsBefore);
    expect(await prisma.auditLog.count({ where: { tenantId, action: "accounts.install_standard_chart" } })).toBe(0);
    await prisma.journalEntry.delete({ where: { id: entry.id } });
  });

  it("refuses with 409 when the company holds only a draft sales invoice", async () => {
    const [customer, revenue] = await Promise.all([
      prisma.customer.findFirstOrThrow({ where: { companyId } }),
      prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } }),
    ]);
    const invoice = await prisma.salesInvoice.create({
      data: {
        tenantId, companyId, customerId: customer.id, invoiceNumber: `D-${stamp}`, date: new Date(), invoiceType: "simplified",
        status: "draft", subtotal: 100, vatTotal: 15, grandTotal: 115,
        lines: { create: [{ accountId: revenue.id, quantity: 1, unitPrice: 100, subtotal: 100, vat: 15, total: 115 }] },
      },
    });
    expect((await install({ companyId, confirmation: "INSTALL_STANDARD_CHART" })).status).toBe(409);
    expect(await prisma.salesInvoice.count({ where: { id: invoice.id } })).toBe(1);
    await prisma.salesInvoice.delete({ where: { id: invoice.id } });
  });

  it("an entry posted while the install waits on the company lock is seen by the check (409, nothing replaced)", async () => {
    const [cash, revenue] = await Promise.all([
      prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } }),
      prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } }),
    ]);
    const accountsBefore = await prisma.account.count({ where: { companyId } });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => { locked = r; });
    // نفس ما يفعله كل ترحيل: يحدّث صف الشركة (حجز رقم القيد) ثم يكتب القيد، داخل معاملة واحدة
    const posting = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "companies" SET "nextJournalEntrySeq" = "nextJournalEntrySeq" + 1 WHERE id = ${companyId}`;
      locked();
      await gate;
      await tx.journalEntry.create({
        data: {
          tenantId, companyId, date: new Date(), status: "posted", entryNumber: `RACE-${stamp}`, sourceModule: "manual",
          lines: { create: [{ accountId: cash.id, debit: 5, credit: 0 }, { accountId: revenue.id, debit: 0, credit: 5 }] },
        },
      });
    }, { timeout: 20_000 });
    await lockTaken;
    const installing = install({ companyId, confirmation: "INSTALL_STANDARD_CHART" });
    await new Promise((r) => setTimeout(r, 300)); // التثبيت الآن ينتظر قفل صف الشركة
    release();
    await posting;
    const res = await installing;
    expect(res.status).toBe(409);
    expect(await prisma.journalEntry.count({ where: { tenantId, entryNumber: `RACE-${stamp}` } })).toBe(1);
    expect(await prisma.account.count({ where: { companyId } })).toBe(accountsBefore);
  }, 60_000);
});
