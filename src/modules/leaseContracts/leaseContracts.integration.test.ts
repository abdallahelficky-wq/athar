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
import { INPUT_VAT_ACCOUNT_NAME } from "../../lib/vatAccounts";
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
});
