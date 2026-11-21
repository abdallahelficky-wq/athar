import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";

/**
 * الترقيم الاختياري لقوائم السندات وفواتير المشتريات عبر HTTP الحقيقي: بلا page يبقى الرد مصفوفة (المنتقيات ونافذة ربط
 * الدفعات والبحث السريع تعتمد على ذلك)، ومع page يصير { items, totalCount, page, pageSize, counts } ويلتزم بحجم الصفحة.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `list-page-${stamp}@example.com`;
let tenantId = "";
let server: Server;
let baseUrl = "";

async function get(path: string, token: string) {
  const res = await fetch(`${baseUrl}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

describe("optional list pagination (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email } });
  });

  it("keeps the legacy array without page and returns a page shape with it", async () => {
    const a = await register({ tenantName: "مستأجر الترقيم", businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = a.tenant.id;
    const company = await prisma.company.findFirstOrThrow({ where: { tenantId } });
    for (const base of ["/receipts", "/purchase-invoices"]) {
      const legacy = await get(`${base}?companyId=${company.id}`, a.accessToken);
      expect(legacy.status).toBe(200);
      expect(Array.isArray(legacy.body)).toBe(true);
      const paged = await get(`${base}?companyId=${company.id}&page=1&pageSize=15&status=posted&q=x&dateFrom=2026-01-01&dateTo=2026-12-31`, a.accessToken);
      expect(paged.status).toBe(200);
      expect(paged.body).toMatchObject({ items: [], totalCount: 0, page: 1, pageSize: 15, counts: { all: 0, posted: 0, draft: 0 } });
    }
  });
});
