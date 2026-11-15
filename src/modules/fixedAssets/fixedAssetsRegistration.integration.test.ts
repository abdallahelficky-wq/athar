import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * تسجيل الأصول في سجل الأصول الثابتة عبر مسارات HTTP الحقيقية على Postgres، بمصدرين جديدين غير "شراء جديد":
 *  - cip_transfer: يُنشئ قيد مدين الأصل / دائن المشروعات تحت التنفيذ، ويرفض تجاوز رصيد المشروعات.
 *  - existing: بلا أي قيد جديد (التكلفة مُرحَّلة أصلاً)، يرفض تجاوز رصيد حساب الأصل في الدفاتر، ولا يُهلَك شهر مُرحَّل أصلاً.
 * القيود التمهيدية (رصيد المشروعات والأصل القائم) تُرحَّل عبر /journal-entries الحقيقي لا تُكتب بيدٍ في الجداول.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `fa-reg-${stamp}@example.com`;
const password = "Str0ng-Pass!";
let tenantId = "";
let token = "";
let companyId = "";
let server: Server;
let baseUrl = "";
// cip = مشروعات تحت التنفيذ، machine = حساب الآلات، accDep/depExp = مجمع ومصروف الإهلاك، equity = الطرف الدائن للتمهيد
const acc: Record<"cip" | "machine" | "accDep" | "depExp" | "equity", string> = {} as never;
let categoryId = "";

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

async function post(date: string, lines: { accountId: string; debit?: number; credit?: number }[], memo = "تمهيد") {
  const r = await call("POST", "/journal-entries", { companyId, date, memo, post: true, lines });
  expect(r.status, r.text).toBe(201);
}

async function balance(accountId: string) {
  const a = await prisma.journalEntryLine.aggregate({ _sum: { debit: true, credit: true }, where: { accountId, journalEntry: { companyId, status: "posted" } } });
  return Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0);
}

const entryCount = () => prisma.journalEntry.count({ where: { companyId } });

const assetBody = (over: Record<string, unknown>) => ({
  companyId, categoryId, name: "ماكينة اختبار", purchaseDate: "2025-12-31", cost: 100000,
  usefulLifeYears: 10, salvageValue: 0, depreciationMethod: "straight_line", isDepreciable: true, ...over,
});

describe("fixed asset registration from construction in progress / existing (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `أصول ${stamp}`, businessActivity: "retail", name: "المالك", email, password, country: "SA" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const assets = await prisma.account.findMany({ where: { companyId, type: "asset", isPosting: true, isActive: true }, orderBy: { code: "asc" }, take: 4 });
    expect(assets.length).toBeGreaterThanOrEqual(4);
    [acc.cip, acc.machine, acc.accDep] = [assets[0].id, assets[1].id, assets[2].id];
    acc.depExp = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "expense", isPosting: true, isActive: true } })).id;
    acc.equity = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "equity", isPosting: true, isActive: true } })).id;
    const cat = await call("POST", "/asset-categories", {
      companyId, groupName: "آلات", name: "آلات اختبار",
      assetAccountId: acc.machine, accumulatedDepreciationAccountId: acc.accDep, depreciationExpenseAccountId: acc.depExp,
    });
    expect(cat.status, cat.text).toBe(201);
    categoryId = cat.body.id;
    // مشروعات تحت التنفيذ 150,000 في الدفاتر
    await post("2025-06-30", [{ accountId: acc.cip, debit: 150000 }, { accountId: acc.equity, credit: 150000 }]);
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } }).catch(() => undefined);
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email } });
  });

  it("cip_transfer posts Dr asset / Cr CIP, links the entry, and lowers the CIP balance", async () => {
    const res = await call("POST", "/fixed-assets", assetBody({ source: "cip_transfer", cipAccountId: acc.cip, cost: 60000, name: "ماكينة من المشروعات" }));
    expect(res.status, res.text).toBe(201);
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(asset.isExisting).toBe(false);
    expect(asset.journalEntryId).toBeTruthy();
    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: asset.journalEntryId! } });
    expect(lines.map((l) => [l.accountId, Number(l.debit), Number(l.credit)]).sort()).toEqual(
      [[acc.machine, 60000, 0], [acc.cip, 0, 60000]].sort(),
    );
    expect(await balance(acc.cip)).toBe(90000);
    expect(await balance(acc.machine)).toBe(60000);
  });

  it("cip_transfer rejects a cost larger than the CIP balance and requires a CIP account", async () => {
    const before = await entryCount();
    const tooMuch = await call("POST", "/fixed-assets", assetBody({ source: "cip_transfer", cipAccountId: acc.cip, cost: 90000.01 }));
    expect(tooMuch.status).toBe(400);
    const noCip = await call("POST", "/fixed-assets", assetBody({ source: "cip_transfer" }));
    expect(noCip.status).toBe(400);
    expect(await entryCount()).toBe(before);
    expect(await balance(acc.cip)).toBe(90000);
  });

  it("existing registers an asset already booked in the ledger without creating any entry", async () => {
    // الأصل الثاني مُرحَّل أصلاً في الأستاذ (قيد افتتاحي) 100,000 + مجمع إهلاك 20,000 — يُرحَّلان قبل التسجيل في السجل
    await post("2025-12-31", [{ accountId: acc.machine, debit: 100000 }, { accountId: acc.equity, credit: 100000 }], "افتتاحي آلة قائمة");
    await post("2025-12-31", [{ accountId: acc.equity, debit: 20000 }, { accountId: acc.accDep, credit: 20000 }], "افتتاحي مجمع إهلاك");
    const before = await entryCount();
    const res = await call("POST", "/fixed-assets", assetBody({
      source: "existing", name: "آلة قائمة", cost: 100000, openingAccumulatedDepreciation: 20000, openingDepreciationAsOf: "2025-12-31",
    }));
    expect(res.status, res.text).toBe(201);
    expect(await entryCount()).toBe(before);
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(asset.isExisting).toBe(true);
    expect(asset.journalEntryId).toBeNull();
    expect(Number(asset.openingAccumulatedDepreciation)).toBe(20000);
    expect(res.body.accumulatedDepreciation).toBeGreaterThanOrEqual(20000);
  });

  it("existing rejects what the ledger does not carry (cost over the account balance, opening over the booked accumulated)", async () => {
    const before = await prisma.fixedAsset.count({ where: { tenantId } });
    // رصيد حساب الآلات 160,000 وسُجِّل منه 160,000 في السجل (60,000 + 100,000) — أي زيادة مرفوضة
    const overCost = await call("POST", "/fixed-assets", assetBody({ source: "existing", cost: 1, openingDepreciationAsOf: "2025-12-31" }));
    expect(overCost.status).toBe(400);
    const noAsOf = await call("POST", "/fixed-assets", assetBody({ source: "existing", cost: 1 }));
    expect(noAsOf.status).toBe(400);
    expect(await prisma.fixedAsset.count({ where: { tenantId } })).toBe(before);
  });

  it("monthly depreciation skips the month already booked for an existing asset and charges the following month", async () => {
    const booked = await call("GET", `/depreciation-runs/preview?companyId=${companyId}&month=2025-12`);
    const next = await call("GET", `/depreciation-runs/preview?companyId=${companyId}&month=2026-01`);
    expect(booked.status, booked.text).toBe(200);
    expect(next.status, next.text).toBe(200);
    const existing = (rows: any[]) => rows.find((r) => r.name === "آلة قائمة");
    expect(existing(booked.body.rows)?.monthly ?? 0).toBe(0);
    expect(existing(next.body.rows).monthly).toBeCloseTo(100000 / 10 / 12, 2);
  });
});
