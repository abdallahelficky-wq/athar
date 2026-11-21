import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * البحث السريع في الخادم عبر HTTP الحقيقي: مطابقة جزئية بلا حساسية لحالة الأحرف، حد 5 لكل مجموعة، لا بحث بأقل من
 * حرفين، ولا نتائج من مستأجر آخر ولو تطابق الاسم.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emails = [`qs-a-${stamp}@example.com`, `qs-b-${stamp}@example.com`];
const tenantIds: string[] = [];
let server: Server;
let baseUrl = "";

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("quick search (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: emails } } });
  });

  it("finds partial, case-insensitive matches within the company, at most 5 per group", async () => {
    const a = await register({ tenantName: "مستأجر البحث", businessActivity: "retail", name: "أ", email: emails[0], password: "Str0ng-Pass!" });
    tenantIds.push(a.tenant.id);
    const b = await register({ tenantName: "مستأجر آخر", businessActivity: "retail", name: "ب", email: emails[1], password: "Str0ng-Pass!" });
    tenantIds.push(b.tenant.id);
    const companyA = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    const companyB = await prisma.company.findFirstOrThrow({ where: { tenantId: b.tenant.id } });
    for (let i = 1; i <= 7; i++) expect((await call("POST", "/customers", a.accessToken, { companyId: companyA.id, name: `Zephyr Client ${i}` })).status).toBe(201);
    expect((await call("POST", "/suppliers", a.accessToken, { companyId: companyA.id, name: "zephyr supplies" })).status).toBe(201);
    expect((await call("POST", "/customers", b.accessToken, { companyId: companyB.id, name: "Zephyr Other Tenant" })).status).toBe(201);

    const found = await call("GET", `/quick-search?companyId=${companyA.id}&q=ZEPH`, a.accessToken);
    expect(found.status).toBe(200);
    expect(found.body.customers).toHaveLength(5);
    expect(found.body.customers.every((c: { name: string }) => c.name.startsWith("Zephyr Client"))).toBe(true);
    expect(found.body.suppliers.map((s: { name: string }) => s.name)).toEqual(["zephyr supplies"]);

    const short = await call("GET", `/quick-search?companyId=${companyA.id}&q=Z`, a.accessToken);
    expect(short.body.customers).toEqual([]);

    // شركة مستأجر آخر: مرفوض/فارغ — لا تسرّب
    const cross = await call("GET", `/quick-search?companyId=${companyB.id}&q=Zephyr`, a.accessToken);
    expect(cross.status === 403 || (cross.status === 200 && cross.body.customers.length === 0)).toBe(true);
  });
});
