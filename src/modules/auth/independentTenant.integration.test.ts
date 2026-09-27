import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { login, register } from "./auth.service";

/**
 * «شركة مستقلة» من داخل جلسة قائمة، عبر مسارات HTTP الحقيقية على Postgres فعلي:
 * - تُنشئ مستأجراً جديداً (رمز منشأة مختلف، مالكه نفس الهوية) دون إصدار رموز أو تغيير الجلسة الحالية؛
 * - تُزرَع شركته بنفس دالة التسجيل تماماً (شجرة حسابات وأصناف ومستودع وأطراف نقدية مطابقة)؛
 * - الانتقال إليها قرار صريح (POST /auth/switch) محصور في عضويات نفس الهوية؛
 * - شاشة اختيار الحساب عند الدخول تعرض المستأجرين معاً؛
 * - ولا يرى أيٌّ من المستأجرين شيئاً من الآخر: شركات، عملاء، قيود، تقارير.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const email = `independent-owner-${stamp}@example.com`;
const otherEmail = `independent-other-${stamp}@example.com`;
const password = "Str0ng-Pass!";
const tenantIds: string[] = [];

let server: Server;
let baseUrl = "";

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function chartOf(companyId: string) {
  const accounts = await prisma.account.findMany({
    where: { companyId },
    select: { code: true, name: true, type: true, parent: { select: { code: true } } },
    orderBy: { code: "asc" },
  });
  return accounts.map((a) => ({ code: a.code, name: a.name, type: a.type, parent: a.parent?.code ?? null }));
}

async function seededCounts(companyId: string) {
  const [items, warehouses, customers, suppliers] = await Promise.all([
    prisma.item.count({ where: { companyId } }),
    prisma.warehouse.count({ where: { companyId } }),
    prisma.customer.count({ where: { companyId } }),
    prisma.supplier.count({ where: { companyId } }),
  ]);
  return { items, warehouses, customers, suppliers };
}

describe("independent company (new tenant for the same identity) — integration", () => {
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
    await prisma.identity.deleteMany({ where: { email: { in: [email, otherEmail] } } });
  });

  it("creates a separate, identically seeded tenant without touching the session, and isolates both ways", async () => {
    const a = await register({ tenantName: "مجموعة أ للاختبار", businessActivity: "retail", name: "المالك", email, password });
    tenantIds.push(a.tenant.id);
    const tokenA = a.accessToken;
    const companyA = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });

    // 1) الإنشاء: 201، مستأجر جديد برمز مختلف، وبلا أي رموز دخول في الاستجابة
    const created = await call("POST", "/companies/independent", tokenA, { name: "شركة مستقلة للاختبار", businessActivity: "retail" });
    expect(created.status).toBe(201);
    expect(created.text).not.toMatch(/accessToken|refreshToken/);
    const tenantB = await prisma.tenant.findUniqueOrThrow({ where: { id: created.body.tenant.id } });
    tenantIds.push(tenantB.id);
    expect(tenantB.id).not.toBe(a.tenant.id);
    expect(created.body.tenant.code).toBe(tenantB.code);
    expect(tenantB.code).not.toBe(a.tenant.code);
    expect(tenantB.subscriptionStatus).toBe("trialing");
    expect(tenantB.trialEndsAt).not.toBeNull();

    // المالك: نفس الهوية، بنفس دور ونطاق مالك التسجيل، ومربوط كمالك المستأجر الجديد
    const ownerA = await prisma.user.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    const ownerB = await prisma.user.findFirstOrThrow({ where: { tenantId: tenantB.id } });
    expect(created.body.userId).toBe(ownerB.id);
    expect(ownerB.identityId).toBe(ownerA.identityId);
    expect(ownerB.role).toBe(ownerA.role);
    expect(ownerB.companyScope).toBe("all");
    expect(tenantB.ownerId).toBe(ownerB.id);

    // المستأجر الأصلي لم يتغيّر: شركة واحدة ومستخدم واحد، والجلسة الحالية ما زالت تعمل عليه وحده
    expect(await prisma.company.count({ where: { tenantId: a.tenant.id } })).toBe(1);
    expect(await prisma.user.count({ where: { tenantId: a.tenant.id } })).toBe(1);
    const companiesSeenByA = await call("GET", "/companies", tokenA);
    expect(companiesSeenByA.status).toBe(200);
    expect(companiesSeenByA.body.map((c: { id: string }) => c.id)).toEqual([companyA.id]);

    // 2) نفس الزرع حرفياً: الشجرة والبيانات الابتدائية مطابقة لشركة مسجَّلة بنفس النشاط
    const companyB = await prisma.company.findFirstOrThrow({ where: { tenantId: tenantB.id } });
    expect(companyB.businessActivity).toBe("retail");
    const chartA = await chartOf(companyA.id);
    expect(chartA.length).toBeGreaterThan(50);
    expect(await chartOf(companyB.id)).toEqual(chartA);
    expect(await seededCounts(companyB.id)).toEqual(await seededCounts(companyA.id));

    // 3) الدخول يعرض المستأجرين معاً للاختيار
    const loginResult = await login({ email, password });
    expect("chooseAccount" in loginResult && loginResult.chooseAccount).toBe(true);
    const accounts = "accounts" in loginResult ? loginResult.accounts : [];
    expect(accounts.map((x) => x.tenantId).sort()).toEqual([a.tenant.id, tenantB.id].sort());

    // 4) الانتقال المقصود: رمز جديد لـ B فقط عند الطلب الصريح
    const switched = await call("POST", "/auth/switch", tokenA, { userId: ownerB.id });
    expect(switched.status).toBe(200);
    expect(switched.body.tenant.id).toBe(tenantB.id);
    const tokenB: string = switched.body.accessToken;

    // هوية أخرى لا تستطيع الانتقال لعضوية ليست لها، ولا طلب انتقال بلا جلسة
    const other = await register({ tenantName: "مستأجر غريب", businessActivity: "retail", name: "غريب", email: otherEmail, password });
    tenantIds.push(other.tenant.id);
    expect((await call("POST", "/auth/switch", other.accessToken, { userId: ownerB.id })).status).toBe(404);
    expect((await call("POST", "/auth/switch", null, { userId: ownerB.id })).status).toBe(401);

    // 5) بيانات مميّزة داخل B: عميل وقيد مرحّل بمبلغ فريد
    const customerB = await call("POST", "/customers", tokenB, { companyId: companyB.id, name: "عميل مستقل فريد" });
    expect(customerB.status).toBe(201);
    const [cashB, revenueB] = await Promise.all([
      prisma.account.findFirstOrThrow({ where: { companyId: companyB.id, code: "111001" } }),
      prisma.account.findFirstOrThrow({ where: { companyId: companyB.id, type: "revenue", children: { none: {} } } }),
    ]);
    const entryB = await call("POST", "/journal-entries", tokenB, {
      companyId: companyB.id,
      date: new Date().toISOString(),
      memo: "قيد مستقل فريد",
      post: true,
      lines: [
        { accountId: cashB.id, debit: 12345.67, credit: 0 },
        { accountId: revenueB.id, debit: 0, credit: 12345.67 },
      ],
    });
    expect(entryB.status).toBe(201);

    // 6) من داخل A: لا شيء من B — لا شركات، ولا عملاء، ولا قيود، ولا تقارير
    const aCompanies = await call("GET", "/companies", tokenA);
    expect(aCompanies.text).not.toContain(companyB.id);
    const aCustomers = await call("GET", "/customers", tokenA);
    expect(aCustomers.status).toBe(200);
    expect(aCustomers.text).not.toContain("عميل مستقل فريد");
    const aCustomersForB = await call("GET", `/customers?companyId=${companyB.id}`, tokenA);
    expect(aCustomersForB.text).not.toContain("عميل مستقل فريد");
    const aEntries = await call("GET", "/journal-entries", tokenA);
    expect(aEntries.status).toBe(200);
    expect(aEntries.text).not.toContain("قيد مستقل فريد");
    const aEntriesForB = await call("GET", `/journal-entries?companyId=${companyB.id}`, tokenA);
    expect(aEntriesForB.text).not.toContain("قيد مستقل فريد");
    const aTrial = await call("GET", "/reports/trial-balance", tokenA);
    expect(aTrial.status).toBe(200);
    expect(aTrial.text).not.toContain("12345.67");
    const aTrialForB = await call("GET", `/reports/trial-balance?companyId=${companyB.id}`, tokenA);
    expect(aTrialForB.text).not.toContain("12345.67");

    // والعكس: من داخل B لا يظهر شيء من A، بينما بيانات B نفسها ظاهرة له (المقارنة ليست فارغة زيفاً)
    const bCompanies = await call("GET", "/companies", tokenB);
    expect(bCompanies.body.map((c: { id: string }) => c.id)).toEqual([companyB.id]);
    expect((await call("GET", `/customers?companyId=${companyA.id}`, tokenB)).text).not.toContain(companyA.id);
    expect((await call("GET", "/customers", tokenB)).text).toContain("عميل مستقل فريد");
    expect((await call("GET", "/journal-entries", tokenB)).text).toContain("قيد مستقل فريد");
    expect((await call("GET", "/reports/trial-balance", tokenB)).text).toContain("12345.67");
  }, 120_000);
});
