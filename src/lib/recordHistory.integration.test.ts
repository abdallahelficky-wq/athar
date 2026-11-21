import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { createApp } from "../app";
import { register } from "../modules/auth/auth.service";
import { isAuditActorPropagationInstalled } from "./auditActor";

/**
 * سجل تعديلات المستندات والبيانات الأساسية (مُشغِّل record_row_change + نشر المنفّذ التلقائي) عبر مسارات HTTP
 * الحقيقية على Postgres فعلي:
 * - إنشاء عميل وتعديله من الشاشة يُسجَّلان باسم المستخدم المنفّذ (لا «غير مسجَّل») والحقل الذي تغيّر من/إلى فقط؛
 * - GET /customers/:id/history يعرضهما، الأحدث أولاً؛
 * - مستأجر آخر لا يرى شيئاً من سجل هذا العميل (عزل المستأجر).
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const emailA = `history-a-${stamp}@example.com`;
const emailB = `history-b-${stamp}@example.com`;
const password = "Str0ng-Pass!";
const tenantIds: string[] = [];
let server: Server;
let baseUrl = "";

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("record history (integration)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    for (const tenantId of tenantIds) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.identity.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  });

  it("is installed by createApp", () => {
    expect(isAuditActorPropagationInstalled()).toBe(true);
  });

  it("records who created and edited a customer, exposes it via /history, and isolates tenants", async () => {
    const a = await register({ tenantName: "مستأجر سجل أ", businessActivity: "retail", name: "محاسب أ", email: emailA, password });
    tenantIds.push(a.tenant.id);
    const b = await register({ tenantName: "مستأجر سجل ب", businessActivity: "retail", name: "محاسب ب", email: emailB, password });
    tenantIds.push(b.tenant.id);
    const companyA = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });

    const created = await call("POST", "/customers", a.accessToken, { companyId: companyA.id, name: "عميل السجل" });
    expect(created.status).toBe(201);
    const customerId = created.body.id ?? created.body.customer?.id;
    expect(customerId).toBeTruthy();

    const edited = await call("PATCH", `/customers/${customerId}`, a.accessToken, { name: "عميل السجل المعدَّل" });
    expect(edited.status).toBe(200);

    const history = await call("GET", `/customers/${customerId}/history`, a.accessToken);
    expect(history.status).toBe(200);
    const actions = history.body.map((r: { action: string }) => r.action);
    expect(actions).toContain("customer.created");
    expect(actions).toContain("customer.updated");
    const update = history.body.find((r: { action: string }) => r.action === "customer.updated");
    expect(update.actorName).toBe("محاسب أ");
    expect(update.metadata.changes.name).toEqual({ from: "عميل السجل", to: "عميل السجل المعدَّل" });
    expect(Object.keys(update.metadata.changes)).not.toContain("updatedAt");
    const create = history.body.find((r: { action: string }) => r.action === "customer.created");
    expect(create.actorName).toBe("محاسب أ");
    // الأحدث أولاً
    expect(actions.indexOf("customer.updated")).toBeLessThan(actions.indexOf("customer.created"));

    const fromOtherTenant = await call("GET", `/customers/${customerId}/history`, b.accessToken);
    expect(fromOtherTenant.status).toBe(200);
    expect(fromOtherTenant.body).toEqual([]);
  });
});
