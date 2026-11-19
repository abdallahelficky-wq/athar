import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { addDays } from "../../lib/leaseSchedule";
import { runDueLeaseReminders } from "../../lib/leaseReminderScheduler";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { INPUT_VAT_ACCOUNT_NAME, OUTPUT_VAT_ACCOUNT_NAME } from "../../lib/vatAccounts";
import { register } from "../auth/auth.service";
import { LEASE_AMORTIZATION_ENTRY_LOCKED, LEASE_PAYMENT_ENTRY_LOCKED } from "../journalEntries/journalEntries.service";
import {
  LEASE_EXPENSE_ACCOUNT_NAME, LEASE_PAYMENT_AMORTIZED, LEASE_PAYMENT_NOT_DUE, LEASE_PREPAID_ACCOUNT_NAME, LEASE_RUN_EXISTS,
  LEASE_RUN_NOT_LATEST, LEASE_RUN_OUT_OF_ORDER,
} from "./leaseContracts.service";

/**
 * موديول الإيجارات — على Postgres حقيقي وعبر مسارات HTTP الفعلية. كل قيد يُفحَص هنا أنشأه مسار تأكيد السداد أو ترحيل الإطفاء
 * نفسه ويُقرأ من قاعدة البيانات كما كُتب (CLAUDE.md القاعدة 2). المصنوع يدوياً: طلبات HTTP وملف الاستيراد (يصلان من الخارج فعلاً).
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بمبالغ مختلفة: A عقد شامل الضريبة 402,500 كل 6 أشهر، وB عقد بلا ضريبة 36,666 كل شهرين —
 * أي خلط بينهما يظهر في المبالغ فوراً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `إيجارات ${stamp}`;
let server: Server;
let baseUrl = "";

interface Ctx {
  token: string;
  tenantId: string;
  companyId: string;
  station: string;
  bankAccountId: string;
  contractId: string;
}
const ctx: Record<"a" | "b", Ctx> = {} as never;

async function call(method: string, path: string, token: string, body?: unknown, lang = "ar") {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "accept-language": lang },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const r = await register({ tenantName: `إيجارات ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email: `lease-${key}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const station = (await prisma.costCenter.create({ data: { tenantId, companyId: company.id, name: "محطة مكة النوارية" } })).id;
  const bank = await prisma.account.findFirstOrThrow({ where: { tenantId, companyId: company.id, code: "111003" } });
  if (!bank.isBankOrCash) await prisma.account.update({ where: { id: bank.id }, data: { isBankOrCash: true } });
  return { token: r.accessToken, tenantId, companyId: company.id, station, bankAccountId: bank.id, contractId: "" };
}

async function entryLines(entryId: string) {
  const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: entryId } });
  return lines
    .map((l) => ({ accountId: l.accountId, costCenterId: l.costCenterId, debit: Number(l.debit), credit: Number(l.credit) }))
    .sort((x, y) => y.debit - x.debit || y.credit - x.credit);
}

// نفس محلّل الحسابات الذي يرحّل به النظام
const accountId = (c: Ctx, name: string) => getAccountIdByName(c.tenantId, c.companyId, name);
const calendar = (c: Ctx, from = "2027-01-01", to = "2027-12-31") => call("GET", `/lease-contracts/calendar?companyId=${c.companyId}&from=${from}&to=${to}`, c.token);
const preview = (c: Ctx, month: string) => call("GET", `/lease-contracts/amortization/preview?companyId=${c.companyId}&month=${month}`, c.token);
const postMonth = (c: Ctx, month: string, lang = "ar") => call("POST", "/lease-contracts/amortization", c.token, { companyId: c.companyId, month }, lang);
const paymentsOf = async (c: Ctx) => (await calendar(c)).body.payments as any[];

describe("lease contracts: schedule, payment confirmation and monthly amortization (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.a = await setupTenant("a");
    ctx.b = await setupTenant("b");
  }, 240_000);

  afterAll(async () => {
    server?.close();
    for (const c of Object.values(ctx)) {
      if (!c?.tenantId) continue;
      await prisma.leaseReminderSetting.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.leaseAmortizationRun.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.leasePayment.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.leaseContract.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.leaseBrand.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("creates contracts with payment terms and generates the schedule without duplicating on a second run", async () => {
    const a = ctx.a;
    const created = await call("POST", "/lease-contracts", a.token, {
      companyId: a.companyId, title: "محطة مكة النوارية", counterparty: "المؤجر أ", startDate: "2027-01-01", endDate: "2027-12-31",
      costCenterId: a.station, vatMode: "inclusive", paymentAmount: 402500, paymentEveryMonths: 6, firstDueDate: "2027-01-01",
    });
    expect(created.status, created.text).toBe(201);
    a.contractId = created.body.id;

    const first = await call("POST", `/lease-contracts/${a.contractId}/schedule`, a.token, {});
    expect(first.status, first.text).toBe(201);
    expect(first.body).toEqual({ created: 2, skipped: 0 });
    expect((await call("POST", `/lease-contracts/${a.contractId}/schedule`, a.token, {})).body).toEqual({ created: 0, skipped: 2 });

    const payments = await paymentsOf(a);
    expect(payments.map((p) => [p.dueDate, p.periodFrom, p.periodTo, p.amount, p.vatAmount, p.netAmount, p.status])).toEqual([
      ["2027-01-01", "2027-01-01", "2027-06-30", 402500, 52500, 350000, "due"],
      ["2027-07-01", "2027-07-01", "2027-12-31", 402500, 52500, 350000, "due"],
    ]);

    const b = ctx.b;
    const other = await call("POST", "/lease-contracts", b.token, {
      companyId: b.companyId, title: "محطة مكة النوارية", startDate: "2027-01-01", endDate: "2027-04-30",
      vatMode: "none", paymentAmount: 36666, paymentEveryMonths: 2, firstDueDate: "2027-01-01",
    });
    expect(other.status, other.text).toBe(201);
    b.contractId = other.body.id;
    expect((await call("POST", `/lease-contracts/${b.contractId}/schedule`, b.token, {})).body).toEqual({ created: 2, skipped: 0 });
    expect((await paymentsOf(b)).map((p) => [p.amount, p.vatAmount, p.netAmount])).toEqual([[36666, 0, 36666], [36666, 0, 36666]]);
  });

  it("refuses a cost center or an account from another tenant's company on a contract", async () => {
    const a = ctx.a;
    const foreignStation = await call("PATCH", `/lease-contracts/${a.contractId}`, a.token, { costCenterId: ctx.b.station });
    expect(foreignStation.status).toBe(400);
    const foreignAccount = await call("PATCH", `/lease-contracts/${a.contractId}`, a.token, { prepaidAccountId: ctx.b.bankAccountId });
    expect(foreignAccount.status).toBe(400);
  });

  it("confirming a payment posts prepaid rent + input VAT against the bank, and only once", async () => {
    const a = ctx.a;
    const [first] = await paymentsOf(a);
    const res = await call("POST", `/lease-contracts/payments/${first.id}/confirm`, a.token, { paidOn: "2027-01-05", bankAccountId: a.bankAccountId, reference: "TRX-1" });
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("paid");

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.body.journalEntryId } });
    expect([entry.sourceModule, entry.sourceId, entry.status, entry.date.toISOString().slice(0, 10)]).toEqual(["lease_payment", first.id, "posted", "2027-01-05"]);
    expect(await entryLines(entry.id)).toEqual([
      { accountId: await accountId(a, LEASE_PREPAID_ACCOUNT_NAME), costCenterId: a.station, debit: 350000, credit: 0 },
      { accountId: await accountId(a, INPUT_VAT_ACCOUNT_NAME), costCenterId: null, debit: 52500, credit: 0 },
      { accountId: a.bankAccountId, costCenterId: null, debit: 0, credit: 402500 },
    ]);

    const again = await call("POST", `/lease-contracts/payments/${first.id}/confirm`, a.token, { paidOn: "2027-01-06", bankAccountId: a.bankAccountId }, "en");
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("This payment is not awaiting payment");
    expect(LEASE_PAYMENT_NOT_DUE).toBe("هذه الدفعة ليست بانتظار السداد");
    expect(await prisma.journalEntry.count({ where: { tenantId: a.tenantId, sourceModule: "lease_payment" } })).toBe(1);

    const cal = await calendar(a);
    expect(cal.body.totals).toMatchObject({ due: 805000, paid: 402500, outstanding: 402500, vat: 105000 });
    expect(cal.body.months).toEqual([
      { month: "2027-01", due: 402500, paid: 402500, outstanding: 0, vat: 52500, count: 1 },
      { month: "2027-07", due: 402500, paid: 0, outstanding: 402500, vat: 52500, count: 1 },
    ]);
  });

  it("refuses a bank account from another company, and another tenant cannot see or confirm the payment", async () => {
    const a = ctx.a;
    const [, second] = await paymentsOf(a);
    const foreignBank = await call("POST", `/lease-contracts/payments/${second.id}/confirm`, a.token, { paidOn: "2027-07-01", bankAccountId: ctx.b.bankAccountId });
    expect(foreignBank.status).toBe(400);
    const foreign = await call("POST", `/lease-contracts/payments/${second.id}/confirm`, ctx.b.token, { paidOn: "2027-07-01", bankAccountId: ctx.b.bankAccountId });
    expect(foreign.status).toBe(404);
    const foreignCalendar = await call("GET", `/lease-contracts/calendar?companyId=${a.companyId}&from=2027-01-01&to=2027-12-31`, ctx.b.token);
    expect([400, 403, 404]).toContain(foreignCalendar.status);
    // B يرى دفعاته وحدها، بمبالغه هو
    expect((await calendar(ctx.b)).body.totals).toMatchObject({ due: 73332, paid: 0 });
  });

  it("refuses the generic reverse, mirror, unpost and delete on a lease payment entry", async () => {
    const a = ctx.a;
    const [first] = await paymentsOf(a);
    const before = await entryLines(first.journalEntryId);
    const attempts = [
      await call("POST", `/journal-entries/${first.journalEntryId}/reverse`, a.token, { date: "2027-01-10" }),
      await call("POST", `/journal-entries/${first.journalEntryId}/mirror-suggestion`, a.token, { targetCompanyId: a.companyId }),
      await call("POST", `/journal-entries/${first.journalEntryId}/unpost`, a.token, { pin: "1234" }),
      await call("DELETE", `/journal-entries/${first.journalEntryId}`, a.token),
    ];
    for (const res of attempts) {
      expect(res.status, res.text).toBe(400);
      expect(res.body.error).toBe(LEASE_PAYMENT_ENTRY_LOCKED);
    }
    expect(await entryLines(first.journalEntryId)).toEqual(before);
  });

  it("amortizes the month's share of every paid payment, in month order, once per month", async () => {
    const a = ctx.a;
    const jan = await preview(a, "2027-01");
    expect(jan.status, jan.text).toBe(200);
    expect(jan.body.total).toBe(58333.33);
    expect(jan.body.rows).toHaveLength(1);
    expect(jan.body.rows[0]).toMatchObject({ title: "محطة مكة النوارية", netAmount: 350000, alreadyAmortized: 0, amount: 58333.33 });
    expect(jan.body.unpaid).toEqual([]);

    const posted = await postMonth(a, "2027-01");
    expect(posted.status, posted.text).toBe(201);
    const run = await prisma.leaseAmortizationRun.findUniqueOrThrow({ where: { id: posted.body.id } });
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: run.journalEntryId } });
    expect([entry.sourceModule, entry.sourceId, entry.date.toISOString().slice(0, 10)]).toEqual(["lease_amortization", run.id, "2027-01-31"]);
    expect(await entryLines(entry.id)).toEqual([
      { accountId: await accountId(a, LEASE_EXPENSE_ACCOUNT_NAME), costCenterId: a.station, debit: 58333.33, credit: 0 },
      { accountId: await accountId(a, LEASE_PREPAID_ACCOUNT_NAME), costCenterId: a.station, debit: 0, credit: 58333.33 },
    ]);

    const dup = await postMonth(a, "2027-01", "en");
    expect(dup.status).toBe(400);
    expect(dup.body.error).toBe("Lease amortization for this month was already posted for this company");
    expect(LEASE_RUN_EXISTS).toBe("تم ترحيل إطفاء الإيجارات لهذا الشهر مسبقاً لهذه الشركة");

    // مارس بعد يناير بلا فبراير: يلحق فبراير تلقائياً (شهران)، ثم فبراير بعده مرفوض
    const mar = await postMonth(a, "2027-03");
    expect(mar.status, mar.text).toBe(201);
    expect(mar.body.totalAmount).toBe(116666.67);
    const late = await postMonth(a, "2027-02");
    expect(late.status).toBe(400);
    expect(late.body.error).toBe(LEASE_RUN_OUT_OF_ORDER);

    const unlocked = await call("POST", `/journal-entries/${run.journalEntryId}/reverse`, a.token, { date: "2027-02-01" });
    expect(unlocked.status).toBe(400);
    expect(unlocked.body.error).toBe(LEASE_AMORTIZATION_ENTRY_LOCKED);
  });

  it("does not amortize an unpaid payment, then catches its elapsed months up once it is paid", async () => {
    const a = ctx.a;
    const [, second] = await paymentsOf(a);
    // أغسطس: دفعة يناير أُطفئت 3 أشهر، فتلحق أبريل–يونيو (175,000). دفعة يوليو غير مسدَّدة: تنبيه بلا إطفاء.
    const aug = await preview(a, "2027-08");
    expect(aug.body.rows).toHaveLength(1);
    expect(aug.body.rows[0]).toMatchObject({ alreadyAmortized: 175000, amount: 175000, remainingAfter: 0 });
    expect(aug.body.unpaid).toEqual([{ leasePaymentId: second.id, title: "محطة مكة النوارية", dueDate: "2027-07-01", amount: 402500 }]);

    // تُسدَّد بخصم سداد مقدم: المدفوع فعلاً 345,000 (شامل) يصبح مبلغ الدفعة ويُعاد فصل ضريبته
    const paid = await call("POST", `/lease-contracts/payments/${second.id}/confirm`, a.token, { paidOn: "2027-08-20", bankAccountId: a.bankAccountId, amount: 345000 });
    expect(paid.status, paid.text).toBe(200);
    expect([Number(paid.body.amount), Number(paid.body.vatAmount), Number(paid.body.netAmount)]).toEqual([345000, 45000, 300000]);

    const after = await preview(a, "2027-08");
    expect(after.body.unpaid).toEqual([]);
    expect(after.body.rows.map((r: any) => r.amount).sort((x: number, y: number) => x - y)).toEqual([100000, 175000]);
    const posted = await postMonth(a, "2027-08");
    expect(posted.status, posted.text).toBe(201);
    expect(posted.body.totalAmount).toBe(275000);

    // رصيد «المدفوع مقدماً» في الدفتر = صافي الدفعتين ناقص كل ما أُطفئ
    const prepaid = await accountId(a, LEASE_PREPAID_ACCOUNT_NAME);
    const sums = await prisma.journalEntryLine.aggregate({ where: { accountId: prepaid, journalEntry: { tenantId: a.tenantId, status: "posted" } }, _sum: { debit: true, credit: true } });
    // 350,000 + 300,000 مدين، و58,333.33 + 116,666.67 + 275,000 دائن
    expect([Number(sums._sum.debit), Number(sums._sum.credit)]).toEqual([650000, 450000]);
  });

  it("reversing a payment is refused while amortized; removing amortization needs the PIN and the latest month", async () => {
    const a = ctx.a;
    const [first, second] = await paymentsOf(a);
    const blocked = await call("POST", `/lease-contracts/payments/${second.id}/reverse`, a.token, { reason: "مبلغ خاطئ" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe(LEASE_PAYMENT_AMORTIZED);

    const runs = (await call("GET", `/lease-contracts/amortization?companyId=${a.companyId}`, a.token)).body as any[];
    expect(runs.map((r) => [r.month, r.totalAmount])).toEqual([["2027-08", 275000], ["2027-03", 116666.67], ["2027-01", 58333.33]]);
    const oldest = await call("DELETE", `/lease-contracts/amortization/${runs[2].id}`, a.token, { pin: "1234" });
    expect(oldest.status).toBe(400);
    expect(oldest.body.error).toBe(LEASE_RUN_NOT_LATEST);
    expect((await call("DELETE", `/lease-contracts/amortization/${runs[0].id}`, a.token, { pin: "0000" })).status).toBe(403);
    expect((await call("DELETE", `/lease-contracts/amortization/${runs[0].id}`, ctx.b.token, { pin: "1234" })).status).toBe(404);

    const removed = await call("DELETE", `/lease-contracts/amortization/${runs[0].id}`, a.token, { pin: "1234" });
    expect(removed.status, removed.text).toBe(204);
    expect(await prisma.journalEntry.findUnique({ where: { id: runs[0].journalEntryId } })).toBeNull();

    // دفعة يوليو لم يبقَ لها إطفاء: تُعكَس بقيد عكسي بنفس المصدر وتعود للانتظار
    const reversed = await call("POST", `/lease-contracts/payments/${second.id}/reverse`, a.token, { reason: "مبلغ خاطئ", date: "2027-08-25" });
    expect(reversed.status, reversed.text).toBe(200);
    expect([reversed.body.status, reversed.body.journalEntryId, reversed.body.paidOn]).toEqual(["due", null, null]);
    const original = await entryLines(second.journalEntryId);
    const reversal = await entryLines(reversed.body.lastReversalEntryId);
    expect(reversal).toEqual(expect.arrayContaining(original.map((l) => ({ ...l, debit: l.credit, credit: l.debit }))));
    const reversalEntry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: reversed.body.lastReversalEntryId } });
    expect([reversalEntry.sourceModule, reversalEntry.reversalOfEntryId]).toEqual(["lease_payment", second.journalEntryId]);
    expect((await call("POST", `/lease-contracts/payments/${second.id}/reverse`, a.token, { reason: "ثانية" })).status).toBe(400);

    // دفعة يناير ما زال لها إطفاء (يناير ومارس): تبقى مرفوضة العكس، وعقدها لا يُحذف
    expect((await call("POST", `/lease-contracts/payments/${first.id}/reverse`, a.token, { reason: "x" })).body.error).toBe(LEASE_PAYMENT_AMORTIZED);
    expect((await call("DELETE", `/lease-contracts/${a.contractId}`, a.token)).status).toBe(400);
  });

  it("a waived payment is neither due nor amortized; a payment settled outside the system amortizes only from its start month", async () => {
    const b = ctx.b;
    const [first, second] = await paymentsOf(b);
    const waived = await call("PATCH", `/lease-contracts/payments/${first.id}`, b.token, { status: "waived", note: "فترة سماح" });
    expect(waived.status, waived.text).toBe(200);
    expect((await calendar(b)).body.totals).toMatchObject({ due: 36666, outstanding: 36666 });
    expect((await call("POST", `/lease-contracts/payments/${first.id}/confirm`, b.token, { paidOn: "2027-01-02", bankAccountId: b.bankAccountId })).status).toBe(400);

    // دفعة مارس–أبريل سُدِّدت وقُيِّدت خارج النظام، ومارس صُرف في الدفاتر القديمة: يُطفأ أبريل وحده، بلا قيد سداد
    const external = await call("POST", `/lease-contracts/payments/${second.id}/confirm`, b.token, { paidOn: "2027-03-01", postedExternally: true, amortizeFromMonth: "2027-04" });
    expect(external.status, external.text).toBe(200);
    expect([external.body.status, external.body.journalEntryId, external.body.postedExternally]).toEqual(["paid", null, true]);
    expect(await prisma.journalEntry.count({ where: { tenantId: b.tenantId, sourceModule: "lease_payment" } })).toBe(0);

    expect((await postMonth(b, "2027-03")).status).toBe(400);
    const apr = await postMonth(b, "2027-04");
    expect(apr.status, apr.text).toBe(201);
    expect(apr.body.totalAmount).toBe(18333);
    // A لم يتأثر بإطفاء B
    expect(await prisma.leaseAmortizationRun.count({ where: { tenantId: ctx.a.tenantId } })).toBe(2);
  });

  it("imports contracts with their schedules all-or-nothing", async () => {
    const b = ctx.b;
    const contract = (title: string, costCenterName: string | null) => ({
      title, vatMode: "inclusive", startDate: "2027-01-01", endDate: "2027-12-31", costCenterName,
      payments: [
        { dueDate: "2027-05-01", periodFrom: "2027-05-01", periodTo: "2027-10-31", amount: 57500 },
        { dueDate: "2027-11-01", periodFrom: "2027-11-01", periodTo: "2028-04-30", amount: 57500, status: "waived", note: "متوقفة" },
      ],
    });
    const before = await prisma.leaseContract.count({ where: { tenantId: b.tenantId } });
    const unknownStation = await call("POST", "/lease-contracts/import", b.token, { companyId: b.companyId, contracts: [contract("مكاتب الإدارة", null), contract("محطة جديدة", "محطة لا وجود لها")] });
    expect(unknownStation.status).toBe(400);
    const duplicateTitle = await call("POST", "/lease-contracts/import", b.token, { companyId: b.companyId, contracts: [contract("مكاتب الإدارة", null), contract("محطة مكة النوارية", null)] });
    expect(duplicateTitle.status).toBe(400);
    expect(await prisma.leaseContract.count({ where: { tenantId: b.tenantId } })).toBe(before);

    const ok = await call("POST", "/lease-contracts/import", b.token, { companyId: b.companyId, contracts: [contract("مكاتب الإدارة", "محطة مكة النوارية")] });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body).toEqual({ contracts: 1, payments: 2 });
    const imported = await prisma.leaseContract.findFirstOrThrow({ where: { tenantId: b.tenantId, title: "مكاتب الإدارة" }, include: { payments: { orderBy: { dueDate: "asc" } } } });
    expect(imported.costCenterId).toBe(b.station);
    expect(imported.payments.map((p) => [Number(p.amount), Number(p.vatAmount), Number(p.netAmount), p.status])).toEqual([
      [57500, 7500, 50000, "due"],
      [57500, 7500, 50000, "waived"],
    ]);
    // لا عقد دخل شركة A
    expect(await prisma.leaseContract.count({ where: { tenantId: ctx.a.tenantId } })).toBe(1);
  });

  it("stores contract details and raises renewal-notice and payment alerts for active contracts only", async () => {
    const b = ctx.b;
    const today = riyadhCalendarDay(new Date());
    const contract = (title: string, extra: Record<string, unknown>) => ({
      title, vatMode: "none", startDate: addDays(today, -300), endDate: addDays(today, 70), noticeDays: 60, autoRenew: true,
      contractNumber: "20322444688 / 1-0", contractValue: 100000, signedOn: addDays(today, -310),
      lessorDetails: { type: "company", crNumber: "4030232849", representative: "ممثل المؤجر", mobile: "+966500000000" },
      propertyDetails: { address: "جدة", unitType: "محطة", area: "709.0" },
      payments: [
        { dueDate: addDays(today, -3), periodFrom: addDays(today, -3), periodTo: addDays(today, 26), amount: 1000 },
        { dueDate: addDays(today, 5), periodFrom: addDays(today, 27), periodTo: addDays(today, 56), amount: 2000 },
        { dueDate: addDays(today, 45), periodFrom: addDays(today, 57), periodTo: addDays(today, 70), amount: 3000 },
      ],
      ...extra,
    });
    const imported = await call("POST", "/lease-contracts/import", b.token, { companyId: b.companyId, contracts: [contract("عقد ساري بتنبيهات", {}), contract("عقد موقوف", { isActive: false })] });
    expect(imported.status, imported.text).toBe(201);
    const active = await prisma.leaseContract.findFirstOrThrow({ where: { tenantId: b.tenantId, title: "عقد ساري بتنبيهات" } });
    const stopped = await prisma.leaseContract.findFirstOrThrow({ where: { tenantId: b.tenantId, title: "عقد موقوف" } });
    expect([active.contractNumber, active.noticeDays, active.autoRenew, Number(active.contractValue), active.isActive, stopped.isActive]).toEqual(["20322444688 / 1-0", 60, true, 100000, true, false]);
    expect(active.lessorDetails).toEqual({ type: "company", crNumber: "4030232849", representative: "ممثل المؤجر", mobile: "+966500000000" });

    const alerts = await call("GET", `/lease-contracts/alerts?companyId=${b.companyId}`, b.token);
    expect(alerts.status, alerts.text).toBe(200);
    const mine = (rows: any[]) => rows.filter((r) => r.leaseContractId === active.id || r.id === active.id);
    expect(mine(alerts.body.overdue).map((p: any) => [p.amount, p.days])).toEqual([[1000, -3]]);
    expect(mine(alerts.body.dueSoon).map((p: any) => [p.amount, p.days])).toEqual([[2000, 5]]);
    expect(mine(alerts.body.renewals)).toEqual([expect.objectContaining({ noticeDeadline: addDays(today, 10), daysToDeadline: 10, daysToEnd: 70, kind: "notice_soon", noticeDays: 60, autoRenew: true })]);
    // العقد الموقوف لا ينبّه بدفعاته ولا بتجديده
    const all = [...alerts.body.overdue, ...alerts.body.dueSoon, ...alerts.body.renewals];
    expect(all.some((r: any) => r.leaseContractId === stopped.id || r.id === stopped.id)).toBe(false);

    // مهلة إشعار أطول من الباقي على النهاية: فات آخر موعد للإشعار والعقد لم ينتهِ
    const patched = await call("PATCH", `/lease-contracts/${active.id}`, b.token, { noticeDays: 180, lessorDetails: { type: "individual", idNumber: "1000000001" }, propertyDetails: null });
    expect(patched.status, patched.text).toBe(200);
    const after = await call("GET", `/lease-contracts/alerts?companyId=${b.companyId}`, b.token);
    expect(mine(after.body.renewals)[0]).toMatchObject({ kind: "notice_passed", daysToDeadline: -110 });
    const stored = await prisma.leaseContract.findUniqueOrThrow({ where: { id: active.id } });
    expect([stored.lessorDetails, stored.propertyDetails]).toEqual([{ type: "individual", idNumber: "1000000001" }, null]);
    expect((await call("PATCH", `/lease-contracts/${active.id}`, b.token, { lessorDetails: { unknownKey: "x" } })).status).toBe(400);

    // مستأجر آخر لا يرى تنبيهات هذه الشركة ولا عقودها
    const foreign = await call("GET", `/lease-contracts/alerts?companyId=${b.companyId}`, ctx.a.token);
    expect([400, 403, 404]).toContain(foreign.status);
    const own = await call("GET", `/lease-contracts/alerts?companyId=${ctx.a.companyId}`, ctx.a.token);
    expect(own.status).toBe(200);
    expect([...own.body.overdue, ...own.body.dueSoon, ...own.body.renewals].some((r: any) => r.leaseContractId === active.id || r.id === active.id)).toBe(false);
  });

  it("suspends, stops or ends a contract with a written reason, which silences its alerts and takes its unpaid payments out of what is due", async () => {
    const b = ctx.b;
    const today = riyadhCalendarDay(new Date());
    const imported = await call("POST", "/lease-contracts/import", b.token, {
      companyId: b.companyId,
      contracts: [{
        title: "عقد يُعلَّق", vatMode: "none", startDate: addDays(today, -300), endDate: addDays(today, 40), noticeDays: 60, autoRenew: true,
        payments: [
          { dueDate: addDays(today, -4), periodFrom: addDays(today, -4), periodTo: addDays(today, 10), amount: 7100 },
          { dueDate: addDays(today, 6), periodFrom: addDays(today, 11), periodTo: addDays(today, 40), amount: 7200 },
        ],
      }],
    });
    expect(imported.status, imported.text).toBe(201);
    const contract = await prisma.leaseContract.findFirstOrThrow({ where: { tenantId: b.tenantId, title: "عقد يُعلَّق" } });
    expect([contract.status, contract.isActive]).toEqual(["active", true]);
    // العقد المستورد غير سارٍ من الاختبار السابق حالته «منتهٍ»
    expect((await prisma.leaseContract.findFirstOrThrow({ where: { tenantId: b.tenantId, title: "عقد موقوف" } })).status).toBe("ended");

    const alertIds = async () => {
      const r = await call("GET", `/lease-contracts/alerts?companyId=${b.companyId}`, b.token);
      expect(r.status, r.text).toBe(200);
      return [...r.body.overdue, ...r.body.dueSoon, ...r.body.renewals].filter((x: any) => x.leaseContractId === contract.id || x.id === contract.id).length;
    };
    const calendar = async () => {
      const r = await call("GET", `/lease-contracts/calendar?companyId=${b.companyId}&from=${addDays(today, -10)}&to=${addDays(today, 10)}`, b.token);
      expect(r.status, r.text).toBe(200);
      return r.body;
    };
    expect(await alertIds()).toBe(3); // دفعة متأخرة + دفعة قريبة + تجديد
    const before = await calendar();

    // السبب إلزامي، والمستأجر الآخر لا يغيّر حالة العقد
    expect((await call("POST", `/lease-contracts/${contract.id}/status`, b.token, { status: "suspended" })).status).toBe(400);
    expect((await call("POST", `/lease-contracts/${contract.id}/status`, b.token, { status: "suspended", reason: "  " })).status).toBe(400);
    expect([400, 403, 404]).toContain((await call("POST", `/lease-contracts/${contract.id}/status`, ctx.a.token, { status: "ended", reason: "ليس عقدي" })).status);
    expect((await prisma.leaseContract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("active");

    const suspended = await call("POST", `/lease-contracts/${contract.id}/status`, b.token, { status: "suspended", reason: "لم تُستلَم المحطة وتوجد قضية", effectiveDate: today });
    expect(suspended.status, suspended.text).toBe(200);
    expect([suspended.body.status, suspended.body.isActive, suspended.body.statusReason]).toEqual(["suspended", false, "لم تُستلَم المحطة وتوجد قضية"]);
    expect(await alertIds()).toBe(0);
    const held = await calendar();
    const mine = (cal: any) => cal.payments.filter((p: any) => p.leaseContractId === contract.id).map((p: any) => [p.amount, p.status, p.onHold, p.overdue]);
    expect(mine(held)).toEqual([[7100, "due", true, false], [7200, "due", true, false]]);
    expect(Math.round((before.totals.outstanding - held.totals.outstanding) * 100)).toBe(1430000);
    expect(Math.round((before.totals.overdue - held.totals.overdue) * 100)).toBe(710000);
    expect(held.contracts.find((c: any) => c.id === contract.id)).toMatchObject({ status: "suspended", statusReason: "لم تُستلَم المحطة وتوجد قضية", statusDate: today, isActive: false });

    // نفس الحالة بالسبب نفسه تُرفَض؛ ثم موقوف فمنتهٍ فعودة للسريان، والسجل يحفظ كل تغيير
    expect((await call("POST", `/lease-contracts/${contract.id}/status`, b.token, { status: "suspended", reason: "لم تُستلَم المحطة وتوجد قضية" })).status).toBe(400);
    expect((await call("POST", `/lease-contracts/${contract.id}/status`, b.token, { status: "stopped", reason: "المحطة متوقفة عن العمل" })).status).toBe(200);
    expect((await call("POST", `/lease-contracts/${contract.id}/status`, b.token, { status: "ended", reason: "فُسخ العقد بالتراضي" })).status).toBe(200);
    expect(await alertIds()).toBe(0);
    const back = await call("POST", `/lease-contracts/${contract.id}/status`, b.token, { status: "active" });
    expect(back.status, back.text).toBe(200);
    expect([back.body.status, back.body.isActive, back.body.statusReason]).toEqual(["active", true, null]);
    expect((back.body.statusHistory as any[]).map((h) => [h.status, h.reason])).toEqual([
      ["suspended", "لم تُستلَم المحطة وتوجد قضية"], ["stopped", "المحطة متوقفة عن العمل"], ["ended", "فُسخ العقد بالتراضي"], ["active", null],
    ]);
    expect(await alertIds()).toBe(3);
    expect((await calendar()).totals).toEqual(before.totals);

    // يُترَك منتهياً حتى لا يغيّر تنبيهات الاختبارات التالية
    expect((await call("POST", `/lease-contracts/${contract.id}/status`, b.token, { status: "ended", reason: "نهاية الاختبار" })).status).toBe(200);
  });

  it("returns one contract with all its payments, counts its attachments, and removes them with the contract", async () => {
    const b = ctx.b;
    const today = riyadhCalendarDay(new Date());
    const imported = await call("POST", "/lease-contracts/import", b.token, {
      companyId: b.companyId,
      contracts: [{
        title: "عقد للعرض والمرفقات", vatMode: "none", startDate: addDays(today, -800), endDate: addDays(today, 800), isActive: false, contractNumber: "20174999355 / 1-0",
        payments: [
          { dueDate: addDays(today, -700), periodFrom: addDays(today, -700), periodTo: addDays(today, -400), amount: 5000 },
          { dueDate: addDays(today, 700), periodFrom: addDays(today, 400), periodTo: addDays(today, 700), amount: 6000 },
        ],
      }],
    });
    expect(imported.status, imported.text).toBe(201);
    const contract = await prisma.leaseContract.findFirstOrThrow({ where: { tenantId: b.tenantId, title: "عقد للعرض والمرفقات" } });

    // التفاصيل تعيد كل الدفعات مهما بعُد تاريخها (التقويم محدود بفترة)، والعقد غير الساري دفعاته موقوفة
    const details = await call("GET", `/lease-contracts/${contract.id}/details`, b.token);
    expect(details.status, details.text).toBe(200);
    expect(details.body.contract).toMatchObject({ id: contract.id, contractNumber: "20174999355 / 1-0", status: "ended", attachmentCount: 0 });
    expect(details.body.payments.map((p: any) => [p.amount, p.onHold])).toEqual([[5000, true], [6000, true]]);
    expect(details.body.totals).toEqual({ scheduled: 11000, paid: 0, outstanding: 0, onHold: 11000, overdue: 0 });
    expect([400, 403, 404]).toContain((await call("GET", `/lease-contracts/${contract.id}/details`, ctx.a.token)).status);

    // الرفع الحقيقي يحتاج تخزين R2 غير متاح في الاختبار، فيُنشأ سجل المرفق مباشرة كما يتركه رفع ناجح؛
    // المفحوص هنا مُخرَج النظام: عدّاد التقويم وحذف السجلات مع العقد.
    await prisma.attachment.create({ data: { tenantId: b.tenantId, entityType: "lease_contract", entityId: contract.id, fileName: "عقد.pdf", fileKey: `test/${contract.id}/contract.pdf`, fileSize: 10, mimeType: "application/pdf" } });
    const cal = await call("GET", `/lease-contracts/calendar?companyId=${b.companyId}&from=${today}&to=${today}`, b.token);
    expect(cal.body.contracts.find((c: any) => c.id === contract.id).attachmentCount).toBe(1);
    expect(cal.body.contracts.filter((c: any) => c.id !== contract.id).every((c: any) => c.attachmentCount === 0)).toBe(true);

    const removed = await call("DELETE", `/lease-contracts/${contract.id}`, b.token);
    expect(removed.status, removed.text).toBe(204);
    expect(await prisma.attachment.count({ where: { tenantId: b.tenantId, entityType: "lease_contract", entityId: contract.id } })).toBe(0);
  });

  it("emails the daily lease reminder once per day to the configured recipients, and only when enabled", async () => {
    const b = ctx.b;
    const initial = await call("GET", `/lease-contracts/reminders?companyId=${b.companyId}`, b.token);
    expect(initial.status, initial.text).toBe(200);
    expect([initial.body.enabled, initial.body.hourKsa, initial.body.minuteKsa, initial.body.recipientEmails]).toEqual([false, 8, 0, []]);
    // بلا مستلمين محددين: مدراء الشركة (المالك المسجَّل)
    expect(initial.body.effectiveRecipients).toEqual([`lease-b-${stamp}@example.com`]);

    // غير مفعّل بعد: المُجدوِل لا يرسل شيئاً لهذه الشركة
    const evening = new Date(`${riyadhCalendarDay(new Date())}T17:00:00.000Z`); // 20:00 بتوقيت السعودية في اليوم نفسه
    await runDueLeaseReminders(evening);
    expect(await prisma.leaseReminderSetting.count({ where: { tenantId: b.tenantId } })).toBe(0);

    expect((await call("PUT", "/lease-contracts/reminders", b.token, { companyId: b.companyId, enabled: true, hourKsa: 9, recipientEmails: ["not-an-email"] })).status).toBe(400);
    expect((await call("PUT", "/lease-contracts/reminders", ctx.a.token, { companyId: b.companyId, enabled: true, hourKsa: 9, recipientEmails: [] })).status).toBe(400);
    expect((await call("PUT", "/lease-contracts/reminders", b.token, { companyId: b.companyId, enabled: true, hourKsa: 9, minuteKsa: 60, recipientEmails: [] })).status).toBe(400);
    const saved = await call("PUT", "/lease-contracts/reminders", b.token, { companyId: b.companyId, enabled: true, hourKsa: 9, minuteKsa: 30, recipientEmails: ["Finance@Example.com", "finance@example.com"] });
    expect(saved.status, saved.text).toBe(200);
    expect([saved.body.enabled, saved.body.hourKsa, saved.body.minuteKsa, saved.body.recipientEmails, saved.body.effectiveRecipients]).toEqual([true, 9, 30, ["finance@example.com"], ["finance@example.com"]]);

    // الشركة لها تنبيهات من الاختبار السابق (دفعة متأخرة وعقد فات موعد إشعاره): «إرسال الآن» يرسل ولا يستهلك إرسال اليوم
    const now = await call("POST", "/lease-contracts/reminders/send-now", b.token, { companyId: b.companyId });
    expect(now.status, now.text).toBe(200);
    expect(now.body).toEqual({ sent: true, reason: null, recipients: 1 });
    expect((await prisma.leaseReminderSetting.findFirstOrThrow({ where: { tenantId: b.tenantId } })).lastSentPeriodKey).toBeNull();
    expect((await call("POST", "/lease-contracts/reminders/send-now", ctx.a.token, { companyId: b.companyId })).status).toBe(400);

    // قبل ساعة الإرسال لا يُرسَل؛ بعدها يُرسَل مرة واحدة لليوم
    const early = new Date(`${riyadhCalendarDay(new Date())}T03:00:00.000Z`); // 06:00 بتوقيت السعودية
    await runDueLeaseReminders(early);
    expect((await prisma.leaseReminderSetting.findFirstOrThrow({ where: { tenantId: b.tenantId } })).lastSentPeriodKey).toBeNull();
    // الموعد 09:30: عند 09:29 (في الساعة نفسها) لا يُرسَل، وعند 09:30 يُرسَل
    await runDueLeaseReminders(new Date(`${riyadhCalendarDay(new Date())}T06:29:00.000Z`));
    expect((await prisma.leaseReminderSetting.findFirstOrThrow({ where: { tenantId: b.tenantId } })).lastSentPeriodKey).toBeNull();
    const onTime = new Date(`${riyadhCalendarDay(new Date())}T06:30:00.000Z`);
    await runDueLeaseReminders(onTime);
    expect((await prisma.leaseReminderSetting.findFirstOrThrow({ where: { tenantId: b.tenantId } })).lastSentAt?.toISOString()).toBe(onTime.toISOString());
    await runDueLeaseReminders(evening);
    const first = await prisma.leaseReminderSetting.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    expect(first.lastSentPeriodKey).toBe(riyadhCalendarDay(new Date()));
    await runDueLeaseReminders(new Date(evening.getTime() + 60 * 60 * 1000));
    const second = await prisma.leaseReminderSetting.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    expect(second.lastSentAt?.toISOString()).toBe(first.lastSentAt?.toISOString());

    // شركة بلا تنبيهات لا يُرسَل لها بريد فارغ
    await prisma.leasePayment.deleteMany({ where: { tenantId: ctx.a.tenantId, status: "due" } });
    const quiet = await call("POST", "/lease-contracts/reminders/send-now", ctx.a.token, { companyId: ctx.a.companyId });
    expect(quiet.status, quiet.text).toBe(200);
    expect(quiet.body).toMatchObject({ sent: false });
  });

  it("seeds brands per company, links them to contracts in the same company only, and returns them in the calendar", async () => {
    const [a, b] = [ctx.a, ctx.b];
    const brandsA = await call("GET", `/lease-contracts/brands?companyId=${a.companyId}`, a.token);
    expect(brandsA.status, brandsA.text).toBe(200);
    expect(brandsA.body.map((x: any) => x.name)).toEqual(expect.arrayContaining(["بروق", "أدنوك", "مزايا", "الدريس", "بترومين", "بترولي"]));
    // الطلب الثاني لا يكرّر البذر
    expect((await call("GET", `/lease-contracts/brands?companyId=${a.companyId}`, a.token)).body.length).toBe(brandsA.body.length);
    const broqA = brandsA.body.find((x: any) => x.name === "بروق");
    const brandsB = (await call("GET", `/lease-contracts/brands?companyId=${b.companyId}`, b.token)).body;
    const broqB = brandsB.find((x: any) => x.name === "بروق");
    expect(broqB.id).not.toBe(broqA.id);

    // مستأجر B لا يقرأ علامات A ولا يعدّلها ولا يربط عقده بها
    expect((await call("GET", `/lease-contracts/brands?companyId=${a.companyId}`, b.token)).status).toBeGreaterThanOrEqual(400);
    expect((await call("PATCH", `/lease-contracts/brands/${broqA.id}`, b.token, { name: "مسروقة" })).status).toBe(404);
    const otherContract = await prisma.leaseContract.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    const cross = await call("PATCH", `/lease-contracts/${otherContract.id}`, b.token, { brandId: broqA.id });
    expect(cross.status).toBe(400);
    expect(cross.body.error ?? cross.text).toContain("العلامة التجارية غير موجودة في هذه الشركة");

    const linked = await call("PATCH", `/lease-contracts/${a.contractId}`, a.token, { brandId: broqA.id, propertyDetails: { city: "مكة المكرمة" } });
    expect(linked.status, linked.text).toBe(200);
    const cal = (await calendar(a)).body.contracts.find((c: any) => c.id === a.contractId);
    expect([cal.brandId, cal.brandName]).toEqual([broqA.id, "بروق"]);

    // علامة مستخدمة لا تُحذف؛ توقَف
    expect((await call("DELETE", `/lease-contracts/brands/${broqA.id}`, a.token)).status).toBe(400);
    const off = await call("PATCH", `/lease-contracts/brands/${broqA.id}`, a.token, { isActive: false });
    expect([off.status, off.body.isActive]).toEqual([200, false]);
    const added = await call("POST", "/lease-contracts/brands", a.token, { companyId: a.companyId, name: "علامة اختبار", color: "#123456" });
    expect(added.status, added.text).toBe(201);
    expect((await call("POST", "/lease-contracts/brands", a.token, { companyId: a.companyId, name: "علامة اختبار" })).status).toBe(400);
    expect((await call("DELETE", `/lease-contracts/brands/${added.body.id}`, a.token)).status).toBe(204);
  });

  it("builds renewal/termination notice letters from the contract, saves them, and keeps them inside the tenant", async () => {
    const [a, b] = [ctx.a, ctx.b];
    const renewal = await call("POST", `/lease-contracts/${a.contractId}/notices/preview`, a.token, { kind: "renewal" });
    expect(renewal.status, renewal.text).toBe(200);
    expect(renewal.body.subject).toContain("تجديد");
    expect(renewal.body.body).toContain("المؤجر أ");
    expect(renewal.body.body).toContain("مكة المكرمة");
    expect(renewal.body.body).toContain(SHARED_NAME);
    const termination = await call("POST", `/lease-contracts/${a.contractId}/notices/preview`, a.token, { kind: "termination" });
    expect(termination.body.subject).toContain("بعدم تجديد");

    expect((await call("POST", `/lease-contracts/${a.contractId}/notices/preview`, b.token, { kind: "renewal" })).status).toBe(404);
    expect((await call("GET", `/lease-contracts/${a.contractId}/notices`, b.token)).status).toBe(404);

    const saved = await call("POST", `/lease-contracts/${a.contractId}/notices`, a.token, {
      kind: "termination", subject: termination.body.subject, body: termination.body.body, recipientEmails: [`lease-a-${stamp}@example.com`], send: true,
    });
    expect(saved.status, saved.text).toBe(201);
    expect(saved.body.sentAt).toBeTruthy();
    expect((await call("POST", `/lease-contracts/${a.contractId}/notices`, a.token, {
      kind: "renewal", subject: renewal.body.subject, body: renewal.body.body, recipientEmails: [], send: true,
    })).status).toBe(400);
    const list = await call("GET", `/lease-contracts/${a.contractId}/notices`, a.token);
    expect(list.body.map((n: any) => [n.kind, n.tenantId])).toEqual([["termination", a.tenantId]]);
  });

  it("posts a leased-out (lessor) contract as collection + unearned rent, amortizes it to revenue, and keeps its totals apart", async () => {
    const b = ctx.b;
    const posting = (type: "revenue" | "liability") =>
      prisma.account.findFirstOrThrow({ where: { tenantId: b.tenantId, companyId: b.companyId, type, isPosting: true, isActive: true, isArchived: false, isBankOrCash: false }, orderBy: { code: "asc" } });
    const [revenue, unearned] = await Promise.all([posting("revenue"), posting("liability")]);
    const created = await call("POST", "/lease-contracts", b.token, {
      companyId: b.companyId, title: "مطعم داخل المحطة", counterparty: "مستأجر المطعم", direction: "lessor", category: "shop_restaurant",
      startDate: "2027-01-01", endDate: "2027-06-30", vatMode: "inclusive", paymentAmount: 69000, paymentEveryMonths: 6, firstDueDate: "2027-01-01",
      expenseAccountId: revenue.id, prepaidAccountId: unearned.id,
      propertyDetails: { city: "جدة", mapUrl: "https://maps.google.com/?q=21.5,39.2" },
    });
    expect(created.status, created.text).toBe(201);
    expect([created.body.direction, created.body.category]).toEqual(["lessor", "shop_restaurant"]);
    const id = created.body.id;
    // رابط غير http(s) مرفوض
    expect((await call("PATCH", `/lease-contracts/${id}`, b.token, { propertyDetails: { mapUrl: "javascript:alert(1)" } })).status).toBe(400);

    expect((await call("POST", `/lease-contracts/${id}/schedule`, b.token, {})).status).toBe(201);
    const cal = await calendar(b);
    const pay = (cal.body.payments as any[]).find((p) => p.leaseContractId === id);
    expect(pay.direction).toBe("lessor");
    // تحصيلات المؤجر لا تدخل مجاميع المدفوعات
    expect(cal.body.totalsLessor.due).toBe(69000);
    const lesseeDue = (cal.body.payments as any[]).filter((p) => p.direction === "lessee" && p.status !== "waived" && !p.onHold).reduce((x, p) => x + p.amount, 0);
    expect(cal.body.totals.due).toBeCloseTo(lesseeDue, 2);

    const confirmed = await call("POST", `/lease-contracts/payments/${pay.id}/confirm`, b.token, { paidOn: "2027-01-05", bankAccountId: b.bankAccountId });
    expect(confirmed.status, confirmed.text).toBe(200);
    const outputVat = await accountId(b, OUTPUT_VAT_ACCOUNT_NAME);
    expect(await entryLines(confirmed.body.journalEntryId)).toEqual([
      { accountId: b.bankAccountId, costCenterId: null, debit: 69000, credit: 0 },
      { accountId: unearned.id, costCenterId: null, debit: 0, credit: 60000 },
      { accountId: outputVat, costCenterId: null, debit: 0, credit: 9000 },
    ].sort((x, y) => y.debit - x.debit || y.credit - x.credit));

    // لا يُغيَّر الاتجاه بعد التحصيل
    const locked = await call("PATCH", `/lease-contracts/${id}`, b.token, { direction: "lessee" });
    expect(locked.status).toBe(400);
    expect(locked.body.error).toContain("لا يُغيَّر اتجاه العقد");

    const prev = await preview(b, "2027-01");
    const row = prev.body.rows.find((r: any) => r.leaseContractId === id);
    expect([row.direction, row.amount]).toEqual(["lessor", 10000]);
  });
});
