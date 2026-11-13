import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signEmployeePortalToken } from "../../lib/jwt";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { createPurchaseInvoice } from "../purchaseInvoices/purchaseInvoices.service";
import { ptsSignature } from "../forecourt/ptsReceiver.service";

/**
 * الوردية الآلية — على Postgres حقيقي وعبر HTTP من أوله لآخره (CLAUDE.md القاعدة 2): المتحكم يُسجَّل ويُربط عبر /forecourt، وعمليات
 * البيع تصل عبر /api/pts/upload موقَّعة كما يوقّع الجهاز (حقول مثال مواصفة jsonPTS ص313 — مُدخَل خارجي مسموح صنعه)، والعامل يفتح
 * ويقفل عبر بوابة الموظف، والمحاسب يعتمد عبر /station-shifts. لا قراءة ولا وردية مكتوبة يدوياً في القاعدة.
 *
 * مستأجران تحمل شركتاهما الاسم نفسه ومتحكماهما نفس أرقام النقاط: A يبيع 30 لتراً وB يبيع 40 — أي خلط يظهر في الأرقام فوراً.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const SHARED_NAME = `ورديات آلية ${stamp}`;
let server: Server;
let baseUrl = "";

interface Ctx {
  email: string;
  token: string;
  worker: string;
  tenantId: string;
  companyId: string;
  station: string;
  employeeId: string;
  nozzles: string[];
  controllerId: string;
  serial: string;
  secret: string;
}
const ctx: Record<"a" | "b", Ctx> = {} as never;

async function call(method: string, path: string, token: string, body?: unknown) {
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
const portal = (c: Ctx, method: string, path: string, body?: unknown) => call(method, `/employee-portal/station-shifts${path}`, c.worker, body);

/** الوقت المحلي للجهاز (الرياض UTC+3، الإزاحة الافتراضية للمتحكم) بصيغة DateTime في jsonPTS، قبل الآن بـ secondsAgo. */
function deviceLocal(secondsAgo: number) {
  return new Date(Date.now() + 3 * 3600_000 - secondsAgo * 1000).toISOString().slice(0, 19);
}

/** عملية بيع كما يرفعها الجهاز: نقطة 1 فوهة 1، والعداد التراكمي بعدها totalVolume. */
async function uploadSale(c: Ctx, transaction: number, volume: number, totalVolume: number, secondsAgo: number) {
  const message = {
    Protocol: "jsonPTS", PtsId: c.serial,
    Packets: [{ Id: transaction, Type: "UploadPumpTransaction", Data: {
      DateTime: deviceLocal(secondsAgo), DateTimeStart: deviceLocal(secondsAgo + 30), Pump: 1, Nozzle: 1, Transaction: transaction,
      Volume: volume, Amount: Number((volume * 2.3).toFixed(2)), Price: 2.3, TotalVolume: totalVolume, TotalAmount: Number((totalVolume * 2.3).toFixed(2)), ConfigurationId: "f522cc01",
    } }],
  };
  const body = Buffer.from(`${JSON.stringify(message)}\r\n`);
  const res = await fetch(`${baseUrl}/api/pts/upload`, { method: "POST", headers: { "content-type": "application/json", "x-pts-id": c.serial, "x-data-signature": ptsSignature(c.secret, body) }, body });
  expect(res.status).toBe(200);
}

async function setupTenant(key: "a" | "b"): Promise<Ctx> {
  const email = `autoshift-${key}-${stamp}@example.com`;
  const r = await register({ tenantName: `آلية ${key} ${stamp}`, businessActivity: "fuel_stations", name: "المالك", email, password: "Str0ng-Pass!" });
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
    data: { tenantId, companyId: company.id, name: "عامل المحطة", hireDate: new Date("2026-01-01"), basicSalary: 3000, assignedCostCenterId: station, portalActive: true },
  })).id;
  // الاعتماد يفحص تكلفة الوقود مسبقاً: صنف الديزل مربوط، ومستودع للمحطة، ومتوسط تكلفة من فاتورة شراء حقيقية
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

  // نفس الرقم التسلسلي لا يُسجَّل مرتين — لكل مستأجر جهازه، ونفس أرقام النقاط في الجهازين
  const serial = `0A${key.toUpperCase()}${String(stamp)}`.padEnd(24, "F").slice(0, 24).toUpperCase();
  const controller = await call("POST", "/forecourt/controllers", token, { companyId: company.id, costCenterId: station, deviceSerial: serial });
  expect(controller.status, controller.text).toBe(201);
  const secret = (await call("POST", `/forecourt/controllers/${controller.body.id}/secret`, token)).body.secretKey;
  return {
    email, token, worker: signEmployeePortalToken({ employeeId, tenantId }), tenantId, companyId: company.id, station, employeeId, nozzles,
    controllerId: controller.body.id, serial, secret,
  };
}

const mapNozzle = (c: Ctx, ptsNozzle: number, nozzleId: string) =>
  call("PUT", `/forecourt/controllers/${c.controllerId}/nozzle-map`, c.token, { ptsPump: 1, ptsNozzle, nozzleId });

describe("automated station shifts (integration)", () => {
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
      await prisma.forecourtPumpTransaction.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.forecourtController.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stockMovement.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.stationShift.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.tenant.update({ where: { id: c.tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: c.tenantId } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      await prisma.identity.deleteMany({ where: { email: c.email } }).catch(() => undefined);
    }
  });

  it("is manual until every active nozzle is mapped to the station's controller", async () => {
    const a = ctx.a;
    expect((await mapNozzle(a, 1, a.nozzles[0])).status).toBe(200);
    const partial = await portal(a, "GET", "/my-station");
    expect(partial.status, partial.text).toBe(200);
    expect(partial.body.automated).toBe(false);

    expect((await mapNozzle(a, 2, a.nozzles[1])).status).toBe(200);
    expect((await portal(a, "GET", "/my-station")).body.automated).toBe(true);
    for (const [i, n] of ctx.b.nozzles.entries()) expect((await mapNozzle(ctx.b, i + 1, n)).status).toBe(200);
    expect((await portal(ctx.b, "GET", "/my-station")).body.automated).toBe(true);
  });

  it("opens with readings from the chain, closes from the controller's totalizers, and chains into the next shift", async () => {
    const a = ctx.a;
    // بيع قبل أول وردية (بين التعريف وبدء التشغيل): أول وردية تفتح من عداد الجهاز 1005 لا من قراءة التعريف 1000
    await uploadSale(a, 1, 5, 1005, 300);
    const opened = await portal(a, "POST", "", { shiftType: "morning" });
    expect(opened.status, opened.text).toBe(201);
    expect(opened.body.readingsSource).toBe("controller");
    const shiftId = opened.body.id;

    // قراءات كل الفوهات أُنشئت عند الفتح من قراءة التعريف، بلا إقفال بعد
    const atOpen = await portal(a, "GET", `/${shiftId}/summary`);
    expect(atOpen.body.readings.map((r: any) => [r.nozzleId, Number(r.openingReading), r.closingReading])).toEqual([[a.nozzles[0], 1005, null], [a.nozzles[1], 2000, null]]);
    expect(atOpen.body.sales).toMatchObject({ liters: 0 });

    // لا وردية ثانية وهذه مفتوحة، ولا تصوير عدادات في الوردية الآلية
    const second = await portal(a, "POST", "", { shiftType: "night" });
    expect(second.status).toBe(400);
    expect(second.text).toContain("توجد وردية مفتوحة");
    const photo = await portal(a, "POST", `/${shiftId}/readings`, { nozzleId: a.nozzles[0], capturedAt: new Date().toISOString() });
    expect(photo.status).toBe(400);

    // B يبيع 40 لتراً على نفس رقم النقطة في جهازه — لا يمسّ وردية A
    const bShift = await portal(ctx.b, "POST", "", { shiftType: "morning" });
    expect(bShift.status, bShift.text).toBe(201);
    await uploadSale(ctx.b, 1, 40, 1040, 120);
    await uploadSale(a, 2, 30, 1035, 120);

    // الملخص الحي للعامل: لترات ومبلغ لكل منتج بسعر المحطة (30 × 2.30 = 69) والإجمالي — لا عجز ولا زيادة
    const live = await portal(a, "GET", `/${shiftId}/summary`);
    expect(live.body.sales).toEqual({
      liters: 30, amount: 69,
      products: [{ product: "diesel", liters: 30, price: 2.3, amount: 69 }],
      nozzles: [{ nozzleId: a.nozzles[0], currentReading: 1035, liters: 30 }, { nozzleId: a.nozzles[1], currentReading: 2000, liters: 0 }],
    });
    for (const leaked of ["cashDue", "variance"]) expect(live.body.sales).not.toHaveProperty(leaked);

    expect((await portal(a, "PUT", `/${shiftId}/collections`, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 69 })).status).toBe(200);
    const closed = await portal(a, "POST", `/${shiftId}/submit`);
    expect(closed.status, closed.text).toBe(200);
    expect(closed.body.status).toBe("submitted");
    const rows = await prisma.stationShiftReading.findMany({ where: { shiftId }, orderBy: { openingReading: "asc" } });
    expect(rows.map((r) => [Number(r.openingReading), Number(r.closingReading)])).toEqual([[1005, 1035], [2000, 2000]]);

    // المحاسب يعتمد بلا صور ولا كتابة قيم: المبيعات 30 × 2.30 = 69 والنقد مطابق
    const review = await call("GET", `/station-shifts/${shiftId}`, a.token);
    expect(review.status, review.text).toBe(200);
    expect(Number(review.body.summary.grossSales)).toBe(69);
    expect(Number(review.body.summary.variance)).toBe(0);
    const approved = await call("POST", `/station-shifts/${shiftId}/approve`, a.token);
    expect(approved.status, approved.text).toBe(200);

    // الوردية التالية تفتح من إقفال السابقة وتُقفَل من العملية التالية للجهاز
    const next = await portal(a, "POST", "", { shiftType: "night" });
    expect(next.status, next.text).toBe(201);
    await uploadSale(a, 3, 15, 1050, 0);
    expect((await portal(a, "PUT", `/${next.body.id}/collections`, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 34.5 })).status).toBe(200);
    expect((await portal(a, "POST", `/${next.body.id}/submit`)).status).toBe(200);
    const nextRows = await prisma.stationShiftReading.findMany({ where: { shiftId: next.body.id }, orderBy: { openingReading: "asc" } });
    expect(nextRows.map((r) => [Number(r.openingReading), Number(r.closingReading)])).toEqual([[1035, 1050], [2000, 2000]]);

    // B: 40 لتراً من جهازه هو، وورديته وملخصه لا يُفتحان لعامل A ولا لمحاسبه
    expect((await portal(ctx.b, "GET", `/${bShift.body.id}/summary`)).body.sales.liters).toBe(40);
    expect([403, 404]).toContain((await portal(a, "GET", `/${bShift.body.id}/summary`)).status);
    expect([403, 404]).toContain((await call("GET", `/station-shifts/${bShift.body.id}`, a.token)).status);
  });

  it("keeps the manual photo flow for a station whose controller is switched off", async () => {
    const b = ctx.b;
    const open = await prisma.stationShift.findFirstOrThrow({ where: { tenantId: b.tenantId, status: "open" } });
    expect((await portal(b, "PUT", `/${open.id}/collections`, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 92 })).status).toBe(200);
    expect((await portal(b, "POST", `/${open.id}/submit`)).status).toBe(200);
    expect((await call("PATCH", `/forecourt/controllers/${b.controllerId}`, b.token, { isActive: false })).status).toBe(200);
    expect((await portal(b, "GET", "/my-station")).body.automated).toBe(false);
    const manual = await portal(b, "POST", "", { shiftType: "night" });
    expect(manual.status, manual.text).toBe(201);
    expect(manual.body.readingsSource).toBe("photo");
    const reading = await portal(b, "POST", `/${manual.body.id}/readings`, { nozzleId: b.nozzles[0], capturedAt: new Date().toISOString() });
    expect(reading.status, reading.text).toBe(201);
  });
});
