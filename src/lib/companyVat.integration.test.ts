import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { createApp } from "../app";
import { register } from "../modules/auth/auth.service";

/**
 * نسبة الضريبة لكل شركة بحسب دولتها، عبر مسارات HTTP الحقيقية على Postgres: شركة مصرية تُنشأ بـ14% وتحسب فواتير
 * مبيعاتها ومشترياتها بها (سعر غير شامل وشامل)، وتعديل النسبة يسري على المستند التالي، والسعودية تبقى 15% مهما أُرسل.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const password = "Str0ng-Pass!";
const emails = [`vat-eg-${stamp}@example.com`, `vat-sa-${stamp}@example.com`];
const tenantIds: string[] = [];
let server: Server;
let baseUrl = "";

interface Ctx { token: string; companyId: string; customerId: string; supplierId: string; revenue: string; expense: string }
const ctx: Record<"eg" | "sa", Ctx> = {} as any;

async function call(c: Ctx, method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${c.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

async function setup(country: "EG" | "SA", email: string): Promise<Ctx> {
  const r = await register({ tenantName: `ضريبة ${country} ${stamp}`, businessActivity: "retail", name: "المالك", email, password, country });
  tenantIds.push(r.tenant.id);
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  const c: Ctx = {
    token: r.accessToken, companyId, customerId: "", supplierId: "",
    revenue: (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id,
    expense: (await prisma.account.findFirstOrThrow({ where: { companyId, type: "expense", isPosting: true } })).id,
  };
  c.customerId = (await call(c, "POST", "/customers", { companyId, name: "عميل" })).body.id;
  c.supplierId = (await call(c, "POST", "/suppliers", { companyId, name: "مورد" })).body.id;
  return c;
}

async function sale(c: Ctx, unitPrice: number, priceIncludesVat: boolean, post = false) {
  const res = await call(c, "POST", "/sales-invoices", {
    companyId: c.companyId, customerId: c.customerId, date: "2026-10-10T09:00:00.000Z", post,
    lines: [{ accountId: c.revenue, description: "بند", quantity: 1, unitPrice, priceIncludesVat }],
  });
  expect(res.status, res.text).toBe(201);
  const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: res.body.id ?? res.body.invoice?.id } });
  return { subtotal: Number(inv.subtotal), vat: Number(inv.vatTotal), total: Number(inv.grandTotal), id: inv.id };
}
const amounts = ({ subtotal, vat, total }: { subtotal: number; vat: number; total: number }) => ({ subtotal, vat, total });

describe("company VAT rate by country (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ctx.eg = await setup("EG", emails[0]);
    ctx.sa = await setup("SA", emails[1]);
  }, 120_000);

  afterAll(async () => {
    server?.close();
    for (const id of tenantIds) {
      await prisma.tenant.update({ where: { id }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId: id } }).catch(() => undefined);
      await prisma.salesReturn.deleteMany({ where: { tenantId: id } });
      await prisma.salesInvoice.deleteMany({ where: { tenantId: id } });
      await prisma.purchaseInvoice.deleteMany({ where: { tenantId: id } });
      await prisma.stockMovement.deleteMany({ where: { tenantId: id } });
      await prisma.journalEntry.deleteMany({ where: { tenantId: id } });
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  });

  it("an Egyptian company is created with 14% and invoices at 14%", async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.eg.companyId } });
    expect({ country: company.country, currency: company.currency, vatRate: Number(company.vatRate) }).toEqual({ country: "EG", currency: "EGP", vatRate: 14 });
    expect(amounts(await sale(ctx.eg, 100, false))).toEqual({ subtotal: 100, vat: 14, total: 114 });
    expect(amounts(await sale(ctx.eg, 114, true))).toEqual({ subtotal: 100, vat: 14, total: 114 });
    const pi = await call(ctx.eg, "POST", "/purchase-invoices", {
      companyId: ctx.eg.companyId, supplierId: ctx.eg.supplierId, date: "2026-10-12T09:00:00.000Z",
      lines: [{ accountId: ctx.eg.expense, description: "مصروف", quantity: 1, unitPrice: 400, priceIncludesVat: false }],
    });
    expect(pi.status, pi.text).toBe(201);
    expect(Number((await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id: pi.body.id ?? pi.body.invoice?.id } })).vatTotal)).toBe(56);
  });

  it("an edited rate applies to the next document; switching the country to Saudi Arabia forces 15%", async () => {
    expect((await call(ctx.eg, "PATCH", `/companies/${ctx.eg.companyId}`, { vatRate: 10 })).status).toBeLessThan(300);
    expect(amounts(await sale(ctx.eg, 100, false))).toEqual({ subtotal: 100, vat: 10, total: 110 });
    expect((await call(ctx.eg, "PATCH", `/companies/${ctx.eg.companyId}`, { vatRate: 101 })).status).toBe(400);
    expect((await call(ctx.eg, "PATCH", `/companies/${ctx.eg.companyId}`, { country: "AE" })).status).toBeLessThan(300);
    expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: ctx.eg.companyId } })).vatRate)).toBe(5);
    expect((await call(ctx.eg, "PATCH", `/companies/${ctx.eg.companyId}`, { country: "SA", vatRate: 5 })).status).toBeLessThan(300);
    expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: ctx.eg.companyId } })).vatRate)).toBe(15);
  });

  it("validates the company tax number by its country", async () => {
    expect((await call(ctx.eg, "PATCH", `/companies/${ctx.eg.companyId}`, { country: "EG", vatNumber: "300000000000003" })).status).toBe(400);
    expect((await call(ctx.eg, "PATCH", `/companies/${ctx.eg.companyId}`, { country: "EG", vatNumber: "100-531-385" })).status).toBeLessThan(300);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: ctx.eg.companyId } })).vatNumber).toBe("100531385");
    // تغيير الدولة إلى عُمان مع رقم مصري ⇒ مرفوض؛ ورقم عُماني بحروف صغيرة يُوحَّد
    expect((await call(ctx.eg, "PATCH", `/companies/${ctx.eg.companyId}`, { country: "OM" })).status).toBe(400);
    expect((await call(ctx.eg, "PATCH", `/companies/${ctx.eg.companyId}`, { country: "OM", vatNumber: "om 1100000000" })).status).toBeLessThan(300);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: ctx.eg.companyId } })).vatNumber).toBe("OM1100000000");
    expect((await call(ctx.sa, "PATCH", `/companies/${ctx.sa.companyId}`, { vatNumber: "123456789" })).status).toBe(400);
    expect((await call(ctx.sa, "PATCH", `/companies/${ctx.sa.companyId}`, { vatNumber: "300000000000003" })).status).toBeLessThan(300);
  });

  it("a Saudi company stays at 15% whatever rate is sent", async () => {
    expect((await call(ctx.sa, "PATCH", `/companies/${ctx.sa.companyId}`, { vatRate: 5 })).status).toBeLessThan(300);
    expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: ctx.sa.companyId } })).vatRate)).toBe(15);
    expect(amounts(await sale(ctx.sa, 100, false))).toEqual({ subtotal: 100, vat: 15, total: 115 });
  });
});
