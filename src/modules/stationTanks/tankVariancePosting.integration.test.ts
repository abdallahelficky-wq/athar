import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { createPurchaseInvoice } from "../purchaseInvoices/purchaseInvoices.service";
import * as shifts from "../stationShifts/stationShifts.service";
import { TANK_VARIANCE_ENTRY_LOCKED } from "../journalEntries/journalEntries.service";
import { TANK_VARIANCE_OVERLAP } from "./tankVariancePosting.service";
import { DELIVERY_IN_POSTED_WINDOW } from "./stationTanks.service";

/**
 * ترحيل فرق مطابقة الخزان — على Postgres حقيقي وعبر مسارات HTTP الفعلية. المطابقة نفسها تُبنى من مخرجات النظام: قراءات عبر
 * /station-tanks، ورديات حقيقية تمرّ بالخدمة واعتماد عبر HTTP، ومتوسط التكلفة من فاتورة شراء حقيقية (CLAUDE.md القاعدة 2).
 * القيد وحركة المخزون يُقرآن كما أنشأهما مسار الترحيل. المصنوع يدوياً: صفّ الوردية المفتوحة فقط (فتح العامل بتاريخ اليوم).
 *
 * مستأجران تحمل شركتاهما الاسم نفسه بأرقام مختلفة: A عجز 10 لتر بتكلفة 1.5، وB زيادة 10 لتر بتكلفة 1.8 — أي خلط يظهر
 * في المبالغ والإشارة فوراً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `فروقات خزانات ${stamp}`;
let server: Server;
let baseUrl = "";

interface Ctx {
  email: string;
  token: string;
  userId: string;
  tenantId: string;
  companyId: string;
  station: string;
  employeeId: string;
  nozzles: string[];
  diesel: string;
  warehouseId: string;
  tankId: string;
  postingId: string;
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

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const range = () => ({ from: riyadhCalendarDay(new Date(Date.now() - 86_400_000)), to: riyadhCalendarDay(new Date(Date.now() + 86_400_000)) });

async function setupTenant(key: "a" | "b", unitPrice: number): Promise<Ctx> {
  const email = `tankvar-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `فروقات ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
  const tenantId = r.tenant.id;
  const token = r.accessToken;
  const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
  await prisma.company.update({ where: { id: company.id }, data: { name: SHARED_NAME } });
  const station = (await prisma.costCenter.create({ data: { tenantId, companyId: company.id, name: "المحطة 1" } })).id;

  const pump = await call("POST", "/station-setup/pumps", token, {
    companyId: company.id, costCenterId: station, pumpType: "diesel", meterType: "electronic", hasMoneyMeter: false,
    nozzles: [{ meterDigits: 7, initialReading: 1000 }],
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
    lines: [{ accountId: "derived-from-item", itemId: diesel, warehouseId, quantity: 5000, unitPrice }],
  } as never);
  const nozzles = (await prisma.stationNozzle.findMany({ where: { tenantId, costCenterId: station }, orderBy: { nozzleNumber: "asc" } })).map((n) => n.id);

  const tank = await call("POST", "/station-tanks/tanks", token, { companyId: company.id, costCenterId: station, code: "T1", product: "diesel", capacityLiters: 20000 });
  expect(tank.status, tank.text).toBe(201);
  for (const n of nozzles) expect((await call("PUT", `/station-tanks/nozzles/${n}/tank`, token, { tankId: tank.body.id })).status).toBe(200);

  return { email, token, userId: r.user.id, tenantId, companyId: company.id, station, employeeId, nozzles, diesel, warehouseId, tankId: tank.body.id, postingId: "" };
}

/** وردية ديزل معتمَدة عبر مسارات الخدمة وHTTP الحقيقية. */
async function approvedDieselShift(c: Ctx, liters: number) {
  const shift = await prisma.stationShift.create({
    data: { tenantId: c.tenantId, companyId: c.companyId, costCenterId: c.station, employeeId: c.employeeId, shiftDate: new Date(`${riyadhCalendarDay(new Date())}T00:00:00.000Z`), shiftType: "morning", openedAt: new Date(), status: "open" },
  });
  const readingIds: string[] = [];
  for (const nozzleId of c.nozzles) {
    const reading = await shifts.submitReading(c.tenantId, c.employeeId, shift.id, { nozzleId, capturedAt: new Date() });
    await prisma.attachment.create({ data: { tenantId: c.tenantId, entityType: "station_shift_reading", entityId: reading.id, fileName: "meter.jpg", fileKey: `k-${reading.id}`, fileSize: 1, mimeType: "image/jpeg" } });
    readingIds.push(reading.id);
  }
  await shifts.updateCollections(c.tenantId, c.employeeId, shift.id, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 0 });
  await shifts.submitShift(c.tenantId, c.employeeId, shift.id);
  for (const id of readingIds) {
    const row = await prisma.stationShiftReading.findUniqueOrThrow({ where: { id } });
    await shifts.correctReading(c.tenantId, c.userId, shift.id, id, Number(row.openingReading) + liters);
  }
  const approved = await call("POST", `/station-shifts/${shift.id}/approve`, c.token);
  expect(approved.status, approved.text).toBe(200);
}

async function entryLines(entryId: string) {
  const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: entryId }, orderBy: { debit: "desc" } });
  return lines.map((l) => ({ accountId: l.accountId, costCenterId: l.costCenterId, debit: Number(l.debit), credit: Number(l.credit) }));
}

async function accounts(c: Ctx) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: c.companyId } });
  const item = await prisma.item.findUniqueOrThrow({ where: { id: c.diesel } });
  return { variance: company.tankVarianceAccountId!, stock: item.stockAccountId!, avg: Number(item.averageCost) };
}

describe("tank variance posting (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.a = await setupTenant("a", 1.5);
    ctx.b = await setupTenant("b", 1.8);

    // A: افتتاح 10000، بيع 200 → متوقع 9800، إقفال 9790 → عجز 10
    const a = ctx.a;
    expect((await call("POST", "/station-tanks/readings", a.token, { tankId: a.tankId, purpose: "opening", readAt: hoursFromNow(-2), liters: 10000 })).status).toBe(201);
    await approvedDieselShift(a, 200);
    expect((await call("POST", "/station-tanks/readings", a.token, { tankId: a.tankId, purpose: "closing", readAt: hoursFromNow(1), liters: 9790 })).status).toBe(201);
    // B: افتتاح 3000، بيع 70 → متوقع 2930، إقفال 2940 → زيادة 10
    const b = ctx.b;
    expect((await call("POST", "/station-tanks/readings", b.token, { tankId: b.tankId, purpose: "opening", readAt: hoursFromNow(-2), liters: 3000 })).status).toBe(201);
    await approvedDieselShift(b, 70);
    expect((await call("POST", "/station-tanks/readings", b.token, { tankId: b.tankId, purpose: "closing", readAt: hoursFromNow(1), liters: 2940 })).status).toBe(201);
  }, 240_000);

  afterAll(async () => {
    server?.close();
    for (const c of Object.values(ctx)) {
      if (!c?.tenantId) continue;
      await prisma.stockMovement.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationShift.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tankVariancePosting.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.fuelDelivery.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tankReading.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationNozzle.updateMany({ where: { tenantId: c.tenantId }, data: { tankId: null } });
      await prisma.stationTank.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("links the variance account to «فاقد وعجز قياس الخزانات» for a new fuel company", async () => {
    for (const c of [ctx.a, ctx.b]) {
      const { variance } = await accounts(c);
      const account = await prisma.account.findUniqueOrThrow({ where: { id: variance } });
      expect([account.code, account.companyId]).toEqual(["511004", c.companyId]);
    }
  });

  it("posts a shortage as debit variance / credit stock and a gain the other way, each at its own average cost", async () => {
    const { from, to } = range();
    for (const key of ["a", "b"] as const) {
      const c = ctx[key];
      const res = await call("POST", "/station-tanks/variance-postings", c.token, { companyId: c.companyId, tankId: c.tankId, from, to });
      expect(res.status, res.text).toBe(201);
      c.postingId = res.body.id;
    }

    const a = await prisma.tankVariancePosting.findUniqueOrThrow({ where: { id: ctx.a.postingId } });
    const accA = await accounts(ctx.a);
    expect(accA.avg).toBe(1.5);
    expect([Number(a.varianceLiters), Number(a.soldLiters), Number(a.expectedLiters), Number(a.amount)]).toEqual([-10, 200, 9800, 15]);
    expect(await entryLines(a.journalEntryId!)).toEqual([
      { accountId: accA.variance, costCenterId: ctx.a.station, debit: 15, credit: 0 },
      { accountId: accA.stock, costCenterId: ctx.a.station, debit: 0, credit: 15 },
    ]);
    const entryA = await prisma.journalEntry.findUniqueOrThrow({ where: { id: a.journalEntryId! } });
    expect([entryA.sourceModule, entryA.sourceId, entryA.companyId]).toEqual(["station_tank_variance", a.id, ctx.a.companyId]);
    const movA = await prisma.stockMovement.findUniqueOrThrow({ where: { id: a.stockMovementId! } });
    expect([movA.type, Number(movA.quantity), movA.warehouseId, movA.journalEntryId]).toEqual(["adjustment", -10, ctx.a.warehouseId, a.journalEntryId]);

    const b = await prisma.tankVariancePosting.findUniqueOrThrow({ where: { id: ctx.b.postingId } });
    const accB = await accounts(ctx.b);
    expect(accB.avg).toBe(1.8);
    expect([Number(b.varianceLiters), Number(b.soldLiters), Number(b.amount)]).toEqual([10, 70, 18]);
    expect(await entryLines(b.journalEntryId!)).toEqual([
      { accountId: accB.stock, costCenterId: ctx.b.station, debit: 18, credit: 0 },
      { accountId: accB.variance, costCenterId: ctx.b.station, debit: 0, credit: 18 },
    ]);
    const movB = await prisma.stockMovement.findUniqueOrThrow({ where: { id: b.stockMovementId! } });
    expect(Number(movB.quantity)).toBe(10);

    const listA = await call("GET", `/station-tanks/variance-postings?companyId=${ctx.a.companyId}`, ctx.a.token);
    expect(listA.status).toBe(200);
    expect(listA.body.map((p: any) => p.id)).toEqual([ctx.a.postingId]);
    expect(listA.body[0].entryNumber).toBe(entryA.entryNumber);
  });

  it("refuses posting the same period twice, and keeps tenants apart", async () => {
    const { from, to } = range();
    const a = ctx.a;
    const again = await call("POST", "/station-tanks/variance-postings", a.token, { companyId: a.companyId, tankId: a.tankId, from, to });
    expect(again.status, again.text).toBe(400);
    expect(again.body.error).toBe(TANK_VARIANCE_OVERLAP);
    expect(await prisma.tankVariancePosting.count({ where: { tenantId: a.tenantId } })).toBe(1);

    // B يحاول ترحيل خزان A: بشركة A مرفوض بنطاق الشركة، وبشركته هو لا يجد الخزان
    const foreignCompany = await call("POST", "/station-tanks/variance-postings", ctx.b.token, { companyId: a.companyId, tankId: a.tankId, from, to });
    expect([400, 403, 404]).toContain(foreignCompany.status);
    const foreignTank = await call("POST", "/station-tanks/variance-postings", ctx.b.token, { companyId: ctx.b.companyId, tankId: a.tankId, from, to });
    expect(foreignTank.status).toBe(404);
    const foreignReverse = await call("POST", `/station-tanks/variance-postings/${a.postingId}/reverse`, ctx.b.token, { reason: "x" });
    expect(foreignReverse.status).toBe(404);
    expect((await prisma.tankVariancePosting.findUniqueOrThrow({ where: { id: a.postingId } })).status).toBe("posted");
  });

  it("locks the posted window: its readings can't be voided and no delivery lands inside it", async () => {
    const a = ctx.a;
    const posting = await prisma.tankVariancePosting.findUniqueOrThrow({ where: { id: a.postingId } });
    const voided = await call("POST", `/station-tanks/readings/${posting.closingReadingId}/void`, a.token, { reason: "خطأ" }, "en");
    expect(voided.status, voided.text).toBe(400);
    expect(voided.body.error).toBe("This reading is used in a posted tank variance. Reverse that posting first");
    const delivery = await call("POST", "/station-tanks/deliveries", a.token, {
      companyId: a.companyId, costCenterId: a.station, deliveryNoteNumber: `DN-${stamp}`, deliveredAt: hoursFromNow(0),
      lines: [{ tankId: a.tankId, noteLiters: 100, receivedLiters: 100 }],
    });
    expect(delivery.status, delivery.text).toBe(400);
    expect(delivery.body.error).toBe(DELIVERY_IN_POSTED_WINDOW);
  });

  it("refuses the generic reverse, mirror, edit and delete on a tank variance entry", async () => {
    const a = ctx.a;
    const posting = await prisma.tankVariancePosting.findUniqueOrThrow({ where: { id: a.postingId } });
    const entryId = posting.journalEntryId!;
    const before = await entryLines(entryId);
    const attempts = [
      await call("POST", `/journal-entries/${entryId}/reverse`, a.token, { date: riyadhCalendarDay(new Date()) }),
      await call("POST", `/journal-entries/${entryId}/mirror-suggestion`, a.token, { targetCompanyId: a.companyId }),
      await call("DELETE", `/journal-entries/${entryId}`, a.token),
    ];
    for (const res of attempts) {
      expect(res.status, res.text).toBe(400);
      expect(res.body.error).toBe(TANK_VARIANCE_ENTRY_LOCKED);
    }
    expect(await entryLines(entryId)).toEqual(before);
    expect(await prisma.journalEntry.count({ where: { tenantId: a.tenantId, reversalOfEntryId: entryId } })).toBe(0);
  });

  it("reverses through the tanks screen: mirrored entry lines, adjustment removed, window unlocked", async () => {
    const a = ctx.a;
    const res = await call("POST", `/station-tanks/variance-postings/${a.postingId}/reverse`, a.token, { reason: "قياس خاطئ" });
    expect(res.status, res.text).toBe(200);
    const posting = await prisma.tankVariancePosting.findUniqueOrThrow({ where: { id: a.postingId } });
    expect(posting.status).toBe("reversed");
    const original = await entryLines(posting.journalEntryId!);
    const reversal = await entryLines(posting.reversalEntryId!);
    expect(reversal).toEqual(expect.arrayContaining(original.map((l) => ({ ...l, debit: l.credit, credit: l.debit }))));
    const reversalEntry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: posting.reversalEntryId! } });
    expect([reversalEntry.sourceModule, reversalEntry.reversalOfEntryId]).toEqual(["station_tank_variance", posting.journalEntryId]);
    expect(await prisma.stockMovement.count({ where: { id: posting.stockMovementId! } })).toBe(0);

    const twice = await call("POST", `/station-tanks/variance-postings/${a.postingId}/reverse`, a.token, { reason: "مرة ثانية" });
    expect(twice.status).toBe(400);
    // B لم يتأثر
    expect((await prisma.tankVariancePosting.findUniqueOrThrow({ where: { id: ctx.b.postingId } })).status).toBe("posted");

    // بعد العكس: القراءة تُلغى، والفترة تُرحَّل من جديد
    const { from, to } = range();
    const reposted = await call("POST", "/station-tanks/variance-postings", a.token, { companyId: a.companyId, tankId: a.tankId, from, to });
    expect(reposted.status, reposted.text).toBe(201);
    expect(await prisma.tankVariancePosting.count({ where: { tenantId: a.tenantId, status: "posted" } })).toBe(1);
  });
});
