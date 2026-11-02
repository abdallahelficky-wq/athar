import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { createApp } from "../../app";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { INPUT_VAT_ACCOUNT_NAME } from "../../lib/vatAccounts";
import { register } from "../auth/auth.service";
import { createPurchaseInvoice } from "../purchaseInvoices/purchaseInvoices.service";
import * as shifts from "../stationShifts/stationShifts.service";
import { CARD_SETTLEMENT_ENTRY_LOCKED } from "../journalEntries/journalEntries.service";
import { CARD_FEE_ACCOUNT_MISSING, CARD_SETTLEMENT_OVERLAP, CARD_SETTLEMENT_PENDING_SHIFTS } from "./cardSettlements.service";

/**
 * تسويات الشبكة — على Postgres حقيقي وعبر مسارات HTTP الفعلية. الذمم التي تُقفلها التسوية أنشأها ترحيل ورديات حقيقية (قراءات
 * وتحصيل بالخدمة، اعتماد وترحيل عبر HTTP) — CLAUDE.md القاعدة 2؛ قيد التسوية يُقرأ كما أنشأه مسار التسوية. المصنوع يدوياً:
 * صفّ الوردية المفتوحة (فتح العامل بتاريخ اليوم دائماً)، ومبالغ إشعار البنك (تصل من الخارج فعلاً).
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بأرقام مختلفة: A شبكة 150 سُوّيت كاملة بعمولة، وB شبكة 100 دفع البنك منها 95 — أي خلط
 * يظهر في المبالغ وأرصدة الذمم فوراً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `تسويات الشبكة ${stamp}`;
let server: Server;
let baseUrl = "";
const TODAY = riyadhCalendarDay(new Date());

interface Ctx {
  email: string;
  token: string;
  userId: string;
  tenantId: string;
  companyId: string;
  station: string;
  employeeId: string;
  nozzles: string[];
  bankAccountId: string;
  settlementId: string;
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
  const email = `cardset-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `تسويات ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  const token = r.accessToken;
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const station = (await prisma.costCenter.create({ data: { tenantId, companyId: company.id, name: "المحطة 1" } })).id;

  const pump = await call("POST", "/station-setup/pumps", token, {
    companyId: company.id, costCenterId: station, pumpType: "diesel", meterType: "electronic", hasMoneyMeter: false,
    nozzles: [{ meterDigits: 7, initialReading: 1000 }, { meterDigits: 7, initialReading: 2000 }],
  });
  expect(pump.status, pump.text).toBe(201);
  expect((await call("POST", "/station-setup/fuel-prices", token, { companyId: company.id, product: "diesel", priceInclVat: 2.3, effectiveFrom: "2026-01-01" })).status).toBe(201);
  const employeeId = (await prisma.employee.create({
    data: { tenantId, companyId: company.id, name: "عامل المحطة", hireDate: new Date("2026-01-01"), basicSalary: 3000, assignedCostCenterId: station },
  })).id;
  const diesel = (await prisma.item.findFirstOrThrow({ where: { tenantId, companyId: company.id, code: "0003" } })).id;
  expect((await call("PATCH", `/companies/${company.id}`, token, { stationDieselItemId: diesel })).status).toBe(200);
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { tenantId, companyId: company.id, isDefault: true } })).id;
  expect((await call("PUT", `/station-setup/stations/${station}/warehouse`, token, { companyId: company.id, warehouseId })).status).toBe(200);
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { tenantId, companyId: company.id } });
  await createPurchaseInvoice(tenantId, r.user.id, {
    companyId: company.id, supplierId: supplier.id, date: new Date("2026-10-01"),
    lines: [{ accountId: "derived-from-item", itemId: diesel, warehouseId, quantity: 5000, unitPrice: 1.5 }],
  } as never);
  const nozzles = (await prisma.stationNozzle.findMany({ where: { tenantId, costCenterId: station }, orderBy: { nozzleNumber: "asc" } })).map((n) => n.id);
  const bank = await prisma.account.findFirstOrThrow({ where: { tenantId, companyId: company.id, code: "111003" } });
  if (!bank.isBankOrCash) await prisma.account.update({ where: { id: bank.id }, data: { isBankOrCash: true } });
  return { email, token, userId: r.user.id, tenantId, companyId: company.id, station, employeeId, nozzles, bankAccountId: bank.id, settlementId: "" };
}

/** وردية مرحَّلة عبر مسارات الخدمة وHTTP الحقيقية — لترات على أول فوهة، وتحصيل شبكة ونقد. */
async function postedShift(c: Ctx, liters: number, networkAmount: number, cashDelivered: number) {
  const shift = await prisma.stationShift.create({
    data: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.station, employeeId: c.employeeId, shiftDate: new Date(`${TODAY}T00:00:00.000Z`), shiftType: "morning", openedAt: new Date(), status: "open" },
  });
  const readingIds: { id: string; nozzleId: string }[] = [];
  for (const nozzleId of c.nozzles) {
    const reading = await shifts.submitReading(c.tenantId, c.employeeId, shift.id, { nozzleId, capturedAt: new Date() });
    await prisma.attachment.create({ data: { tenantId: c.tenantId, entityType: "station_shift_reading", entityId: reading.id, fileName: "meter.jpg", fileKey: `k-${reading.id}`, fileSize: 1, mimeType: "image/jpeg" } });
    readingIds.push({ id: reading.id, nozzleId });
  }
  await shifts.updateCollections(c.tenantId, c.employeeId, shift.id, { networkAmount, fuelCardAmount: 0, cashDelivered });
  await shifts.submitShift(c.tenantId, c.employeeId, shift.id);
  for (const r of readingIds) {
    const row = await prisma.stationShiftReading.findUniqueOrThrow({ where: { id: r.id } });
    await shifts.correctReading(c.tenantId, c.userId, shift.id, r.id, Number(row.openingReading) + (r.nozzleId === c.nozzles[0] ? liters : 0));
  }
  const approved = await call("POST", `/station-shifts/${shift.id}/approve`, c.token);
  expect(approved.status, approved.text).toBe(200);
  const posted = await call("POST", `/station-shifts/${shift.id}/post`, c.token);
  expect(posted.status, posted.text).toBe(200);
  return shift.id;
}

async function entryLines(entryId: string) {
  const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: entryId } });
  return lines
    .map((l) => ({ accountId: l.accountId, costCenterId: l.costCenterId, debit: Number(l.debit), credit: Number(l.credit) }))
    .sort((x, y) => y.debit - x.debit || y.credit - x.credit);
}

// نفس محلّل الحسابات الذي يرحّل به النظام (أسماء قياسية بأسمائها البديلة في القوالب)
const accountId = (c: Ctx, name: string) => getAccountIdByName(c.tenantId, c.companyId, name);
const recon = (c: Ctx) => call("GET", `/card-settlements/reconciliation?companyId=${c.companyId}&channel=network&from=${TODAY}&to=${TODAY}`, c.token);
const settle = (c: Ctx, body: Record<string, unknown>, lang = "ar") =>
  call("POST", "/card-settlements", c.token, { companyId: c.companyId, costCenterId: c.station, channel: "network", salesFrom: TODAY, salesTo: TODAY, settledOn: TODAY, bankAccountId: c.bankAccountId, ...body }, lang);

describe("network card settlements (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.a = await setupTenant("a");
    ctx.b = await setupTenant("b");
    // A: 100 لتر × 2.3 = 230 — شبكة 150 ونقد 80. B: 50 لتر = 115 — شبكة 100 ونقد 15.
    await postedShift(ctx.a, 100, 150, 80);
    await postedShift(ctx.b, 50, 100, 15);
  }, 240_000);

  afterAll(async () => {
    server?.close();
    for (const c of Object.values(ctx)) {
      if (!c?.tenantId) continue;
      await prisma.cardSettlement.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stockMovement.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationShift.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("shows each tenant's posted network sales as unsettled, with the receivable balance from the ledger", async () => {
    const ra = await recon(ctx.a);
    expect(ra.status, ra.text).toBe(200);
    expect(ra.body.days).toEqual([expect.objectContaining({ costCenterId: ctx.a.station, day: TODAY, amount: 150, shiftCount: 1, settlementId: null, ageDays: 0 })]);
    expect(ra.body.summary).toEqual([expect.objectContaining({ costCenterId: ctx.a.station, sales: 150, unsettled: 150, unsettledDays: 1, ledgerBalance: 150, pendingShifts: 0 })]);
    const rb = await recon(ctx.b);
    expect(rb.body.summary).toEqual([expect.objectContaining({ costCenterId: ctx.b.station, sales: 100, unsettled: 100, ledgerBalance: 100 })]);
    // B لا يرى مطابقة شركة A
    const foreign = await call("GET", `/card-settlements/reconciliation?companyId=${ctx.a.companyId}&channel=network&from=${TODAY}&to=${TODAY}`, ctx.b.token);
    expect([400, 403, 404]).toContain(foreign.status);
    expect(foreign.body?.days).toBeUndefined();
  });

  it("refuses a fee without a fee account, and a period that still has an unposted shift", async () => {
    const a = ctx.a;
    const noFeeAccount = await settle(a, { netAmount: 148.85, feeAmount: 1, feeVatAmount: 0.15 });
    expect(noFeeAccount.status, noFeeAccount.text).toBe(400);
    expect(noFeeAccount.body.error).toBe(CARD_FEE_ACCOUNT_MISSING);

    const open = await prisma.stationShift.create({
      data: { tenantId: a.tenantId, companyId: a.companyId, costCenterId: a.station, employeeId: a.employeeId, shiftDate: new Date(`${TODAY}T00:00:00.000Z`), shiftType: "evening", openedAt: new Date(), status: "open" },
    });
    expect((await recon(a)).body.summary[0].pendingShifts).toBe(1);
    const pending = await settle(a, { netAmount: 150 });
    expect(pending.status, pending.text).toBe(400);
    expect(pending.body.error).toBe(CARD_SETTLEMENT_PENDING_SHIFTS);
    await prisma.stationShift.delete({ where: { id: open.id } });
    expect(await prisma.cardSettlement.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });

  it("posts the bank deposit: debit bank net + fee + input VAT, credit the station's network receivable gross", async () => {
    const a = ctx.a;
    const feeAccount = await accountId(a, "مصروفات إدارية متنوعة أخرى");
    expect((await call("PATCH", `/companies/${a.companyId}`, a.token, { cardFeeExpenseAccountId: feeAccount })).status).toBe(200);
    const res = await settle(a, { netAmount: 148.85, feeAmount: 1, feeVatAmount: 0.15, reference: "MADA-001" });
    expect(res.status, res.text).toBe(201);
    a.settlementId = res.body.id;
    expect([Number(res.body.expectedAmount), Number(res.body.grossAmount), res.body.shiftCount]).toEqual([150, 150, 1]);

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: res.body.journalEntryId } });
    expect([entry.sourceModule, entry.sourceId, entry.companyId, entry.date.toISOString().slice(0, 10)]).toEqual(["card_settlement", a.settlementId, a.companyId, TODAY]);
    expect(await entryLines(entry.id)).toEqual([
      { accountId: a.bankAccountId, costCenterId: null, debit: 148.85, credit: 0 },
      { accountId: feeAccount, costCenterId: a.station, debit: 1, credit: 0 },
      { accountId: await accountId(a, INPUT_VAT_ACCOUNT_NAME), costCenterId: null, debit: 0.15, credit: 0 },
      { accountId: await accountId(a, shifts.NETWORK_RECEIVABLE_ACCOUNT_NAME), costCenterId: a.station, debit: 0, credit: 150 },
    ]);

    const ra = await recon(a);
    expect(ra.body.days[0]).toMatchObject({ settlementId: a.settlementId, ageDays: null });
    expect(ra.body.summary[0]).toMatchObject({ sales: 150, unsettled: 0, settledGross: 150, fees: 1.15, difference: 0, ledgerBalance: 0 });
  });

  it("keeps a short payment visible: the unpaid part stays in the receivable, per tenant", async () => {
    const b = ctx.b;
    const res = await settle(b, { netAmount: 95 });
    expect(res.status, res.text).toBe(201);
    b.settlementId = res.body.id;
    expect(await entryLines(res.body.journalEntryId)).toEqual([
      { accountId: b.bankAccountId, costCenterId: null, debit: 95, credit: 0 },
      { accountId: await accountId(b, shifts.NETWORK_RECEIVABLE_ACCOUNT_NAME), costCenterId: b.station, debit: 0, credit: 95 },
    ]);
    const rb = await recon(b);
    expect(rb.body.summary[0]).toMatchObject({ sales: 100, unsettled: 0, settledGross: 95, difference: -5, ledgerBalance: 5 });
    // A لم يتأثر
    expect((await recon(ctx.a)).body.summary[0]).toMatchObject({ ledgerBalance: 0, difference: 0 });

    const list = await call("GET", `/card-settlements?companyId=${b.companyId}`, b.token);
    expect(list.body.map((s: any) => [s.id, s.difference])).toEqual([[b.settlementId, -5]]);
  });

  it("refuses an overlapping settlement and another tenant's reversal", async () => {
    const a = ctx.a;
    const again = await settle(a, { netAmount: 10 }, "en");
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("This settlement's period overlaps an existing settlement for the same station and channel");
    expect(CARD_SETTLEMENT_OVERLAP).toBe("فترة هذه التسوية تتداخل مع تسوية قائمة لنفس المحطة والقناة");
    const foreign = await call("POST", `/card-settlements/${a.settlementId}/reverse`, ctx.b.token, { reason: "x" });
    expect(foreign.status).toBe(404);
    // حساب بنك من شركة أخرى مرفوض
    const foreignBank = await settle(ctx.b, { netAmount: 1, bankAccountId: a.bankAccountId, salesFrom: "2026-01-01", salesTo: "2026-01-01", settledOn: "2026-01-02" });
    expect(foreignBank.status).toBe(400);
  });

  it("refuses the generic reverse, mirror and delete on a settlement entry", async () => {
    const a = ctx.a;
    const settlement = await prisma.cardSettlement.findUniqueOrThrow({ where: { id: a.settlementId } });
    const entryId = settlement.journalEntryId!;
    const before = await entryLines(entryId);
    const attempts = [
      await call("POST", `/journal-entries/${entryId}/reverse`, a.token, { date: TODAY }),
      await call("POST", `/journal-entries/${entryId}/mirror-suggestion`, a.token, { targetCompanyId: a.companyId }),
      await call("DELETE", `/journal-entries/${entryId}`, a.token),
    ];
    for (const res of attempts) {
      expect(res.status, res.text).toBe(400);
      expect(res.body.error).toBe(CARD_SETTLEMENT_ENTRY_LOCKED);
    }
    expect(await entryLines(entryId)).toEqual(before);
  });

  it("reverses through the settlements screen: mirrored lines, days unsettled again, receivable restored", async () => {
    const a = ctx.a;
    const res = await call("POST", `/card-settlements/${a.settlementId}/reverse`, a.token, { reason: "مبلغ خاطئ" });
    expect(res.status, res.text).toBe(200);
    const settlement = await prisma.cardSettlement.findUniqueOrThrow({ where: { id: a.settlementId } });
    expect(settlement.status).toBe("reversed");
    const original = await entryLines(settlement.journalEntryId!);
    const reversal = await entryLines(settlement.reversalEntryId!);
    expect(reversal).toEqual(expect.arrayContaining(original.map((l) => ({ ...l, debit: l.credit, credit: l.debit }))));
    const reversalEntry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: settlement.reversalEntryId! } });
    expect([reversalEntry.sourceModule, reversalEntry.reversalOfEntryId]).toEqual(["card_settlement", settlement.journalEntryId]);

    const ra = await recon(a);
    expect(ra.body.days[0]).toMatchObject({ settlementId: null, amount: 150 });
    expect(ra.body.summary[0]).toMatchObject({ unsettled: 150, ledgerBalance: 150 });
    expect((await call("POST", `/card-settlements/${a.settlementId}/reverse`, a.token, { reason: "ثانية" })).status).toBe(400);
    // B لم يتأثر
    expect((await prisma.cardSettlement.findUniqueOrThrow({ where: { id: ctx.b.settlementId } })).status).toBe("posted");
  });
});
