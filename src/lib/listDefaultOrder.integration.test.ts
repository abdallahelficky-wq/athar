import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { createApp } from "../app";
import { register } from "../modules/auth/auth.service";
import { createPump, createFuelPrice } from "../modules/stationSetup/stationSetup.service";
import { openShift, submitShift } from "../modules/stationShifts/stationShifts.service";

/**
 * قرار المالك (#145): كل قائمة مستندات تعرض آخر ما أُدخل أولاً افتراضياً، لا الأحدث تاريخاً — مستند بتاريخ قديم أُدخل اليوم
 * كان يغوص أسفل القائمة فيطبع المستخدم أو يعدّل غيره بالخطأ. هذه المستندات بلا رقم تسلسلي عددي، فالترتيب createdAt ثم id.
 * لكل شاشة: مستند بتاريخ أحدث يُدخَل أولاً، ثم مستند بتاريخ أقدم — الافتراضي يُظهر الثاني أولاً، والترتيب بالتاريخ يبقى بطلب.
 * المستندات من مسارات HTTP الحقيقية (الورديات من خدمة بوابة العامل نفسها — راجع حالة الورديات أدناه).
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
let token = "";
let tenantId = "";
let companyId = "";
const acc: Record<string, string> = {};

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

async function created(method: string, path: string, body: unknown) {
  const res = await call(method, path, body);
  expect(res.status, res.text).toBe(201);
  return res.body;
}

describe("document lists default to last entered first (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `ترتيب القوائم ${stamp}`, businessActivity: "retail", name: "المالك", email: `list-order-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const account = (where: object) => prisma.account.findFirstOrThrow({ where: { companyId, isPosting: true, ...where } }).then((a) => a.id);
    acc.revenue = await account({ type: "revenue" });
    acc.stock = await account({ code: "114001" });
    acc.cogs = await account({ code: "511001" });
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.auditLog.deleteMany({ where: { tenantId } });
  });

  it("sales invoices: an older-dated invoice entered later is first; sortBy=date still orders by date", async () => {
    const customerId = (await created("POST", "/customers", { companyId, name: "عميل الترتيب" })).id;
    const invoice = async (date: string) => {
      const body = await created("POST", "/sales-invoices", {
        companyId, customerId, date, post: true,
        lines: [{ accountId: acc.revenue, description: "بند", quantity: 1, unitPrice: 115, priceIncludesVat: true }],
      });
      return (body.id ?? body.invoice?.id) as string;
    };
    const newerDate = await invoice("2026-09-20T09:00:00.000Z");
    const olderDate = await invoice("2026-01-05T09:00:00.000Z");

    const byDefault = await call("GET", `/sales-invoices/search?companyId=${companyId}&customerId=${customerId}`);
    expect(byDefault.status, byDefault.text).toBe(200);
    expect(byDefault.body.items.map((i: { id: string }) => i.id)).toEqual([olderDate, newerDate]);
    const byDate = await call("GET", `/sales-invoices/search?companyId=${companyId}&customerId=${customerId}&sortBy=date&sortDir=desc`);
    expect(byDate.body.items.map((i: { id: string }) => i.id)).toEqual([newerDate, olderDate]);
    // صفحة بحجم 1: الصفحة الأولى هي آخر ما أُدخل، والثانية ما قبله — ترقيم OFFSET ثابت على الترتيب الجديد
    const p1 = await call("GET", `/sales-invoices/search?companyId=${companyId}&customerId=${customerId}&pageSize=15&page=1`);
    expect(p1.body.items[0].id).toBe(olderDate);
  });

  it("sales returns / credit notes: an older-dated return entered later is first; sortBy=date still orders by date", async () => {
    const customerId = (await created("POST", "/customers", { companyId, name: "عميل المرتجعات" })).id;
    const inv = await created("POST", "/sales-invoices", {
      companyId, customerId, date: "2026-01-02T09:00:00.000Z", post: true,
      lines: [{ accountId: acc.revenue, description: "بند", quantity: 10, unitPrice: 115, priceIncludesVat: true }],
    });
    const invoiceId = (inv.id ?? inv.invoice?.id) as string;
    const line = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId } });
    const salesReturn = async (date: string) => {
      const body = await created("POST", "/sales-returns", {
        companyId, customerId, relatedInvoiceId: invoiceId, date, refundMethod: "account", reason: "مرتجع",
        lines: [{ originalInvoiceLineId: line.id, accountId: acc.revenue, description: "مرتجع", quantity: 1, unitPrice: 115, priceIncludesVat: true }],
      });
      return body.id as string;
    };
    const newerDate = await salesReturn("2026-09-20T09:00:00.000Z");
    const olderDate = await salesReturn("2026-01-05T09:00:00.000Z");

    const byDefault = await call("GET", `/sales-returns/search?companyId=${companyId}&customerId=${customerId}`);
    expect(byDefault.status, byDefault.text).toBe(200);
    expect(byDefault.body.items.map((i: { id: string }) => i.id)).toEqual([olderDate, newerDate]);
    const byDate = await call("GET", `/sales-returns/search?companyId=${companyId}&customerId=${customerId}&sortBy=date&sortDir=desc`);
    expect(byDate.body.items.map((i: { id: string }) => i.id)).toEqual([newerDate, olderDate]);
  });

  it("inventory movements: an older-dated movement entered later is first", async () => {
    const warehouseId = (await created("POST", "/warehouses", { companyId, name: "مستودع الترتيب" })).id;
    const itemId = (await created("POST", "/items", {
      companyId, code: `ORD-${stamp}`, name: "صنف الترتيب", type: "inventory",
      stockAccountId: acc.stock, cogsAccountId: acc.cogs, revenueAccountId: acc.revenue,
    })).id;
    const movement = async (date: string) => {
      const res = await call("POST", "/stock-movements/in-out", { type: "in", itemId, warehouseId, quantity: 1, unitCost: 10, date });
      expect(res.status, res.text).toBe(201);
    };
    await movement("2026-09-20");
    await movement("2026-01-05");

    const list = await call("GET", `/stock-movements?companyId=${companyId}&itemId=${itemId}`);
    expect(list.status, list.text).toBe(200);
    expect(list.body.map((m: { date: string }) => m.date.slice(0, 10))).toEqual(["2026-01-05", "2026-09-20"]);
  });

  it("station sales: an older-dated sale entered later is first", async () => {
    const costCenterId = (await created("POST", "/cost-centers", { companyId, name: `محطة المبيعات ${stamp}` })).id;
    await created("POST", "/station-sales", { companyId, costCenterId, date: "2026-09-20", liters: 100, pricePerLiter: 2.33 });
    await created("POST", "/station-sales", { companyId, costCenterId, date: "2026-01-05", liters: 50, pricePerLiter: 2.33 });

    const list = await call("GET", `/station-sales?companyId=${companyId}`);
    expect(list.status, list.text).toBe(200);
    const mine = list.body.filter((s: { costCenterId: string }) => s.costCenterId === costCenterId);
    expect(mine.map((s: { date: string }) => s.date.slice(0, 10))).toEqual(["2026-01-05", "2026-09-20"]);
  });

  it("station shifts awaiting review: an older-dated shift entered later is first", async () => {
    const costCenterId = (await created("POST", "/cost-centers", { companyId, name: `محطة الورديات ${stamp}` })).id;
    await createPump(tenantId, { companyId, costCenterId, pumpType: "diesel", meterType: "mechanical", hasMoneyMeter: false,
      nozzles: [{ meterDigits: 6, initialReading: 1000 }, { meterDigits: 6, initialReading: 2000 }] });
    await createFuelPrice(tenantId, { companyId, product: "diesel", priceInclVat: 1.66, effectiveFrom: "2020-01-01" });
    const employee = await prisma.employee.create({ data: { tenantId, companyId, name: "عامل الترتيب", hireDate: new Date(), basicSalary: 3000, assignedCostCenterId: costCenterId } });

    // بوابة العامل تفتح الوردية بتاريخ اليوم دائماً (لا يختاره العامل)، فلا ينتج النظام «وردية بتاريخ أقدم أُدخلت لاحقاً»
    // مباشرة: ورديات حقيقية من openShift/submitShift، ثم يُنقَل تاريخ كل واحدة عمداً بعد إرسالها (CLAUDE.md القاعدة 2).
    // ثلاث ورديات لأن الترتيب القديم كان بالتاريخ تصاعدياً — ورديتان فقط قد تتطابقان في الترتيبين.
    const day = (offset: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() + offset * 86_400_000); };
    const enter = async (shiftDate: Date) => {
      const shift = await openShift(tenantId, employee.id, { shiftType: "morning" });
      await submitShift(tenantId, employee.id, shift.id);
      await prisma.stationShift.update({ where: { id: shift.id }, data: { shiftDate } });
      return shift.id;
    };
    const first = await enter(day(-1));   // أُدخلت أولاً، أحدث تاريخاً
    const second = await enter(day(-3));  // أُدخلت بعدها بتاريخ أقدم
    const third = await enter(day(-2));

    const list = await call("GET", `/station-shifts/pending?companyId=${companyId}`);
    expect(list.status, list.text).toBe(200);
    const mine = list.body.filter((s: { costCenterId: string }) => s.costCenterId === costCenterId);
    expect(mine.map((s: { id: string }) => s.id)).toEqual([third, second, first]);
  });
});
