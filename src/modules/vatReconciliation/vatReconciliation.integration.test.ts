import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { hashPassword } from "../../lib/password";
import { lastCompleteFilingPeriod } from "../../lib/vatPeriod";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * ملخصات الضريبة ومطابقتها عبر مسارات HTTP الحقيقية على Postgres فعلي، بمستندات وقيود حقيقية:
 * - لا شركة أو لا فترة ⇒ 400، وشركة مستأجر آخر ⇒ 404 (لا مجموع على عمر الشركة ولا على كل الشركات)؛
 * - حدود الفترة بتوقيت الرياض (فاتورة 00:30 فجر أول يوم داخل الفترة، و23:30 آخر يوم قبلها خارجها)؛
 * - الإشعارات المدينة داخل ملخص المبيعات، وضريبة ورديات المحطات سطر مستقل؛
 * - المطابقة تفصّل كل بند فرق بمبلغه (قيد يدوي، وردية، مستند قيده خارج الفترة، قيد لمستند خارجها)
 *   ويبقى الباقي صفراً، وتعرض ما غاب عن الطرفين (مستند أُلغي ترحيله، قيد محفوظ) وحسابات ضريبة أخرى.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `vat-recon-${stamp}@example.com`;
const otherEmail = `vat-recon-other-${stamp}@example.com`;
const password = "Str0ng-Pass!";
const PIN = "5793";
const tenantIds: string[] = [];

let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
let otherCompanyId = "";
const acc: Record<string, string> = {};
let customerId = "";
let supplierId = "";

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

const Q = "from=2026-07-01&to=2026-09-30";

async function invoice(dateIso: string, grossInclVat: number) {
  const res = await call("POST", "/sales-invoices", {
    companyId, customerId, date: dateIso, post: true,
    lines: [{ accountId: acc.revenue, description: "بند", quantity: 1, unitPrice: grossInclVat, priceIncludesVat: true }],
  });
  expect(res.status, res.text).toBe(201);
  const id: string = res.body.id ?? res.body.invoice?.id;
  return prisma.salesInvoice.findUniqueOrThrow({ where: { id } });
}

async function manualEntry(dateIso: string, lines: { accountId: string; debit: number; credit: number }[], post = true) {
  const res = await call("POST", "/journal-entries", { companyId, date: dateIso, memo: "قيد اختبار الضريبة", post, lines });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

describe("VAT summaries and reconciliation (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const owner = await register({ tenantName: `مطابقة الضريبة ${stamp}`, businessActivity: "retail", name: "المالك", email, password });
    tenantIds.push(owner.tenant.id);
    tenantId = owner.tenant.id;
    token = owner.accessToken;
    await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(PIN) } });
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;

    const other = await register({ tenantName: `مستأجر آخر ${stamp}`, businessActivity: "retail", name: "غريب", email: otherEmail, password });
    tenantIds.push(other.tenant.id);
    otherCompanyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: other.tenant.id } })).id;

    const byCode = async (code: string) => (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
    acc.outputVat = await byCode("213001");
    acc.inputVat = await byCode("113003");
    acc.cash = await byCode("111001");
    acc.revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    acc.expense = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "expense", isPosting: true } })).id;

    customerId = (await call("POST", "/customers", { companyId, name: "عميل الضريبة" })).body.id;
    supplierId = (await call("POST", "/suppliers", { companyId, name: "مورد الضريبة" })).body.id;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    for (const id of tenantIds) {
      await prisma.tenant.update({ where: { id }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: id } }).catch(() => undefined);
      // أسطر المستندات والقيود تشير للحسابات بلا حذف متتالٍ — تُحذف قبل المستأجر
      await prisma.salesInvoice.deleteMany({ where: { tenantId: id } });
      await prisma.salesDebitNote.deleteMany({ where: { tenantId: id } });
      await prisma.purchaseInvoice.deleteMany({ where: { tenantId: id } });
      await prisma.stockMovement.deleteMany({ where: { tenantId: id } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: id } });
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: [email, otherEmail] } } });
  });

  it("refuses without a company or a period, and 404s another tenant's company", async () => {
    for (const path of ["/sales-reports/vat-summary", "/purchase-reports/vat-summary", "/vat-reconciliation"]) {
      expect((await call("GET", `${path}?companyId=${companyId}`)).status).toBe(400);
      expect((await call("GET", `${path}?companyId=${companyId}&from=2026-07-01`)).status).toBe(400);
      expect((await call("GET", `${path}?${Q}`)).status).toBe(400);
      expect((await call("GET", `${path}?companyId=${companyId}&from=2026-09-30&to=2026-07-01`)).status).toBe(400);
      expect((await call("GET", `${path}?companyId=${companyId}&from=2026-02-30&to=2026-03-01`)).status).toBe(400);
      expect((await call("GET", `${path}?companyId=${otherCompanyId}&${Q}`)).status).toBe(404);
    }
  });

  it("computes the last complete filing period in Riyadh time", () => {
    expect(lastCompleteFilingPeriod("quarterly", new Date("2026-09-27T12:00:00Z"))).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(lastCompleteFilingPeriod("quarterly", new Date("2026-01-05T12:00:00Z"))).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(lastCompleteFilingPeriod("monthly", new Date("2026-03-10T12:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // 22:30 UTC يوم 31 = 01:30 فجر أول الشهر التالي بالرياض ⇒ الشهر المكتمل هو الشهر الذي انتهى للتو
    expect(lastCompleteFilingPeriod("monthly", new Date("2026-07-31T22:30:00Z"))).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("itemises every difference between document VAT and the VAT accounts, leaving a zero residual", async () => {
    // داخل الفترة: فاتورة 1150 (ضريبة 150)، وفاتورة 00:30 فجر 1 يوليو بالرياض (ضريبة 15)
    await invoice("2026-08-10T09:00:00.000Z", 1150);
    await invoice("2026-06-30T21:30:00.000Z", 115);
    // خارج الفترة: 23:30 يوم 30 يونيو بالرياض (ضريبة 30)
    await invoice("2026-06-30T20:30:00.000Z", 230);

    // إشعار مدين داخل الفترة (ضريبة 15)
    const dn = await call("POST", "/sales-debit-notes", {
      companyId, customerId, date: "2026-08-15T09:00:00.000Z", chargeMethod: "account",
      lines: [{ accountId: acc.revenue, description: "فرق سعر", quantity: 1, unitPrice: 115, priceIncludesVat: true }],
    });
    expect(dn.status, dn.text).toBe(201);

    // مستند في الفترة قيده خارجها (ضريبة 45): تاريخ القيد يُنقَل إلى أكتوبر
    const moved = await invoice("2026-09-10T09:00:00.000Z", 345);
    await prisma.journalEntry.update({ where: { id: moved.journalEntryId! }, data: { date: new Date("2026-10-02T09:00:00.000Z") } });
    // مستند خارج الفترة قيده داخلها (ضريبة 60)
    const early = await invoice("2026-10-05T09:00:00.000Z", 460);
    await prisma.journalEntry.update({ where: { id: early.journalEntryId! }, data: { date: new Date("2026-09-29T09:00:00.000Z") } });

    // قيد يدوي يمسّ حساب المخرجات (دائن 40)
    await manualEntry("2026-08-20T09:00:00.000Z", [
      { accountId: acc.cash, debit: 40, credit: 0 },
      { accountId: acc.outputVat, debit: 0, credit: 40 },
    ]);
    // قيد محفوظ غير مرحَّل يمسّ الحساب (دائن 7) — خارج المعادلة
    await manualEntry("2026-08-21T09:00:00.000Z", [
      { accountId: acc.cash, debit: 7, credit: 0 },
      { accountId: acc.outputVat, debit: 0, credit: 7 },
    ], false);

    // قيد وردية محطة (مخرجات 30) — بالشكل الذي يكتبه ترحيل الوردية: مصدر station_shift
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    await prisma.journalEntry.create({
      data: {
        tenantId, companyId, date: new Date("2026-08-11T00:00:00.000Z"), status: "posted", sourceModule: "station_shift",
        entryNumber: `${company.numberingPrefix}-VAT-TEST-${stamp}`, memo: "وردية",
        lines: { create: [{ accountId: acc.cash, debit: 230, credit: 0 }, { accountId: acc.revenue, debit: 0, credit: 200 }, { accountId: acc.outputVat, debit: 0, credit: 30 }] },
      },
    });

    // مستند في الفترة أُلغي ترحيله (ضريبة 12) — غائب عن الطرفين، يظهر من سجل التدقيق
    const unposted = await invoice("2026-08-25T09:00:00.000Z", 92);
    const up = await call("POST", `/sales-invoices/${unposted.id}/unpost`, { pin: PIN });
    expect(up.status, up.text).toBe(200);

    // فاتورة مشتريات في الفترة (ضريبة 60)
    const pi = await call("POST", "/purchase-invoices", {
      companyId, supplierId, date: "2026-08-12T09:00:00.000Z",
      lines: [{ accountId: acc.expense, description: "مصروف", quantity: 1, unitPrice: 400, priceIncludesVat: false }],
    });
    expect(pi.status, pi.text).toBe(201);

    // حساب ضريبة آخر بالاسم عليه حركة في الفترة — خارج المطابقة، يُعرَض تحذيراً
    const parent213 = await prisma.account.findFirstOrThrow({ where: { companyId, code: "213" } });
    const stray = await prisma.account.create({
      data: { tenantId, companyId, parentId: parent213.id, code: "213099", level: 4, isPosting: true, type: "liability", name: "ضريبة القيمة المضافة - فرع قديم" },
    });
    await manualEntry("2026-09-01T09:00:00.000Z", [
      { accountId: acc.cash, debit: 9, credit: 0 },
      { accountId: stray.id, debit: 0, credit: 9 },
    ]);

    // ---- ملخص المبيعات ----
    const sales = await call("GET", `/sales-reports/vat-summary?companyId=${companyId}&${Q}`);
    expect(sales.status, sales.text).toBe(200);
    expect(sales.body.invoiceCount).toBe(3); // 150 + 15 (حد الرياض) + 45 (قيده منقول لكن المستند في الفترة)
    expect(sales.body.outputVat).toBe(210);
    expect(sales.body.debitNoteCount).toBe(1);
    expect(sales.body.debitNotesVat).toBe(15);
    expect(sales.body.netOutputVat).toBe(225);
    expect(sales.body.stationShiftVat).toBe(30);
    expect(sales.body.stationShiftCount).toBe(1);
    expect(sales.body.totalOutputVatWithStations).toBe(255);

    const purchases = await call("GET", `/purchase-reports/vat-summary?companyId=${companyId}&${Q}`);
    expect(purchases.status, purchases.text).toBe(200);
    expect(purchases.body.inputVat).toBe(60);
    expect(purchases.body.netInputVat).toBe(60);

    // ---- المطابقة ----
    const recon = await call("GET", `/vat-reconciliation?companyId=${companyId}&${Q}`);
    expect(recon.status, recon.text).toBe(200);
    const out = recon.body.output;
    expect(out.account.code).toBe("213001");
    expect(out.documentVat).toBe(225);
    // الحساب: 150 + 15 + 15 (إشعار) + 60 (قيد لمستند أكتوبر) + 40 (يدوي) + 30 (وردية) = 310؛ الـ45 خرج مع قيده
    expect(out.ledgerMovement).toBe(310);
    expect(out.difference).toBe(85);
    expect(out.items.otherSources.total).toBe(40);
    expect(out.items.otherSources.rows).toHaveLength(1);
    expect(out.items.stationShifts.total).toBe(30);
    expect(out.items.documentEntryOutsidePeriod.total).toBe(-45);
    expect(out.items.documentEntryOutsidePeriod.rows[0]).toMatchObject({ number: moved.invoiceNumber, reason: "entry_outside_period" });
    expect(out.items.entryForDocumentOutsidePeriod.total).toBe(60);
    expect(out.items.entryForDocumentOutsidePeriod.rows[0].document.number).toBe(early.invoiceNumber);
    expect(out.items.amountMismatch.rows).toHaveLength(0);
    expect(out.residual).toBe(0);

    expect(out.outsideBothSides.unpostedDocuments).toHaveLength(1);
    expect(out.outsideBothSides.unpostedDocuments[0]).toMatchObject({ id: unposted.id, documentVat: 12 });
    expect(out.outsideBothSides.unpostedDocuments[0].unpostedBy).toBeTruthy();
    expect(out.outsideBothSides.savedEntries).toHaveLength(1);
    expect(out.outsideBothSides.savedEntries[0].amount).toBe(7);

    const inp = recon.body.input;
    expect(inp.account.code).toBe("113003");
    expect(inp.documentVat).toBe(60);
    expect(inp.ledgerMovement).toBe(60);
    expect(inp.residual).toBe(0);

    expect(recon.body.otherVatNamedAccounts.map((a: { code: string }) => a.code)).toEqual(["213099"]);
    expect(recon.body.otherVatNamedAccounts[0].credit).toBe(9);
    expect(recon.body.netVatPerDocuments).toBe(165);
    expect(recon.body.netVatPerLedger).toBe(250);
  }, 120_000);
});
