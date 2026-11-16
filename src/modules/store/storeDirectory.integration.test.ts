import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * دليل المتاجر العام (GET /api/store) — عبر HTTP (القاعدة 2)، بمستأجرَين (القاعدة 4): لا يُدرَج متجر إلا بموافقة شركته
 * الصريحة (storeListed) وهو مفعَّل، ولا يخرج عنه غير الرابط والاسم.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
let server: Server;
let baseUrl = "";
type Session = { token: string; companyId: string; slug: string };
let a: Session;
let b: Session;

async function call(token: string | null, method: string, url: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function open(label: string): Promise<Session> {
  const r = await register({ tenantName: `دليل ${label} ${stamp}`, businessActivity: "retail", name: "المالك", email: `store-dir-${label}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const companyId = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  return { token: r.accessToken, companyId, slug: `dir-${label}-${stamp}` };
}

const listed = async () => ((await call(null, "GET", "/store")).body as { slug: string }[]).filter((s) => s.slug.endsWith(`-${stamp}`));

describe("public store directory lists only enabled stores that opted in", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    a = await open("a");
    b = await open("b");
  }, 120_000);

  afterAll(() => server?.close());

  it("an enabled store is not listed until its company opts in, and only its link and name are shown", async () => {
    for (const s of [a, b]) {
      const enabled = await call(s.token, "PATCH", `/companies/${s.companyId}`, { storeEnabled: true, storeSlug: s.slug, storeName: `متجر ${s.slug}` });
      expect(enabled.status, enabled.text).toBe(200);
      expect(enabled.body.storeListed).toBe(false);
    }
    expect(await listed()).toEqual([]);
    // المتجر غير المُدرَج يبقى متاحاً برابطه
    expect((await call(null, "GET", `/store/${a.slug}`)).status).toBe(200);

    expect((await call(a.token, "PATCH", `/companies/${a.companyId}`, { storeListed: true })).status).toBe(200);
    const list = await listed();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slug: a.slug, name: `متجر ${a.slug}` });
    expect(Object.keys(list[0]).sort()).toEqual(["name", "nameEn", "slug"]);
  });

  it("a listed store leaves the directory when it is disabled", async () => {
    expect((await call(a.token, "PATCH", `/companies/${a.companyId}`, { storeEnabled: false })).status).toBe(200);
    expect(await listed()).toEqual([]);
  });
});
