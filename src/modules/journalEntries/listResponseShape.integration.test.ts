import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * عقد شكل ردّ GET /journal-entries: بلا طلب ترقيم صريح يبقى المصفوفة القديمة (كل القيود بأسطرها) — مستهلكون كثر يعتمدون
 * عليها (اختبارات، سكريبت unpost-and-delete-entries، تقارير). الشكل المرقّم { items, nextCursor, hasMore } فقط مع
 * paginate=1 أو cursor أو take. كسرُ هذا العقد أفشل خمسة اختبارات في ثلاثة ملفات (#143).
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
let token = "";
let otherToken = "";
let tenantId = "";
let otherTenantId = "";
let companyId = "";

async function get(path: string, t = token) {
  const res = await fetch(`${baseUrl}/api${path}`, { headers: { authorization: `Bearer ${t}` } });
  return { status: res.status, body: await res.json() };
}

describe("GET /journal-entries response shape (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `شكل الرد ${stamp}`, businessActivity: "retail", name: "المالك", email: `shape-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    token = r.accessToken;
    companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const cash = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
    const revenue = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    for (let i = 1; i <= 3; i++) {
      const res = await fetch(`${baseUrl}/api/journal-entries`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId, date: `2026-09-0${i}`, memo: `قيد ${i}`, post: true,
          lines: [{ accountId: cash, debit: 10 * i, credit: 0 }, { accountId: revenue, debit: 0, credit: 10 * i }] }),
      });
      expect(res.status).toBe(201);
    }
    const r2 = await register({ tenantName: `شكل الرد آخر ${stamp}`, businessActivity: "retail", name: "غريب", email: `shape-other-${stamp}@example.com`, password: "Str0ng-Pass!" });
    otherTenantId = r2.tenant.id;
    otherToken = r2.accessToken;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  });

  it("without pagination params: the old array, every entry, lines included, newest-created first", async () => {
    const res = await get(`/journal-entries?companyId=${companyId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((e: { memo: string }) => e.memo)).toEqual(["قيد 3", "قيد 2", "قيد 1"]);
    expect(res.body[0].lines).toHaveLength(2);
    expect(res.body[0].lines[0].account).toBeTruthy();
    // فلتر المبلغ القديم ما زال يعمل على المصفوفة
    const byAmount = await get(`/journal-entries?companyId=${companyId}&amount=20`);
    expect(byAmount.body.map((e: { memo: string }) => e.memo)).toEqual(["قيد 2"]);
  });

  it("paginate=1, take or cursor opt in to { items, nextCursor, hasMore }", async () => {
    const first = await get(`/journal-entries?companyId=${companyId}&paginate=1&take=2`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ hasMore: true });
    expect(first.body.items).toHaveLength(2);
    const second = await get(`/journal-entries?companyId=${companyId}&cursor=${first.body.nextCursor}&take=2`);
    expect(second.body).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.body.items).toHaveLength(1);
    const takeOnly = await get(`/journal-entries?companyId=${companyId}&take=1`);
    expect(Array.isArray(takeOnly.body)).toBe(false);
    expect(takeOnly.body.items).toHaveLength(1);
  });

  it("neither shape shows another tenant's entries", async () => {
    expect((await get("/journal-entries", otherToken)).body).toEqual([]);
    expect((await get("/journal-entries?paginate=1", otherToken)).body.items).toEqual([]);
  });
});
