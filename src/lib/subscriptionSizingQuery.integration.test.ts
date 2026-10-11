import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { createIndependentTenant, register } from "../modules/auth/auth.service";

/**
 * scripts/sql/subscription-migration-sizing.sql — استعلام قراءة للمالك (CLAUDE.md القاعدة 3). اختبار multi-tenant العام في
 * productionQueries.integration.test.ts يشمله تلقائياً؛ هنا منطقه نفسه: ترتيب الشركات لكل هوية مالك عبر مستأجراتها
 * (نطاق الخصم)، مالك آخر بشركة بنفس الاسم لا يختلط، وعدّ المستخدمين لكل شركة بحسب نطاقهم.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const ROOT = path.resolve(__dirname, "../..");
const stamp = Date.now();
const SAME = `مؤسسة مشتركة ${stamp}`;
type Row = { tenant_id: string; company_id: string; owner_identity_id: string | null; owner_rank: bigint | number | null; owner_company_count: bigint | number | null; active_users: bigint | number; companies_in_tenant: bigint | number };
const n = (v: unknown) => (v == null ? null : Number(v));
const tenants: string[] = [];
let ownerA = { identityId: "", first: "", group: "", independent: "" };
let ownerB = { identityId: "", company: "" };

describe("subscription migration sizing query", () => {
  beforeAll(async () => {
    const a = await register({ tenantName: SAME, businessActivity: "retail", name: "مالك أ", email: `sz-a-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenants.push(a.tenant.id);
    const first = await prisma.company.findFirstOrThrow({ where: { tenantId: a.tenant.id } });
    // شركة ثانية ضمن المجموعة نفسها ثم شركة مستقلة (مستأجر جديد) لنفس الهوية — بترتيب إنشاء معروف
    const group = await prisma.company.create({ data: { tenantId: a.tenant.id, name: `فرع المجموعة ${stamp}`, createdAt: new Date(first.createdAt.getTime() + 1000) } });
    const ind = await createIndependentTenant(a.user.id, { name: `مستقلة ${stamp}`, businessActivity: "retail" });
    tenants.push(ind.tenant.id);
    await prisma.company.update({ where: { id: ind.company.id }, data: { createdAt: new Date(first.createdAt.getTime() + 2000) } });
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
    ownerA = { identityId: ownerUser.identityId, first: first.id, group: group.id, independent: ind.company.id };

    // مستخدم نطاقه شركة المجموعة وحدها، ومستخدم محذوف (لا يُعدّ)
    for (const [suffix, data] of [["scoped", { companyScope: group.id }], ["deleted", { companyScope: "all", deletedAt: new Date() }]] as const) {
      const identity = await prisma.identity.create({ data: { email: `sz-${suffix}-${stamp}@example.com` } });
      await prisma.user.create({ data: { tenantId: a.tenant.id, identityId: identity.id, name: suffix, role: "accountant", inviteStatus: "accepted", ...data } });
    }

    const b = await register({ tenantName: SAME, businessActivity: "retail", name: "مالك ب", email: `sz-b-${stamp}@example.com`, password: "Str0ng-Pass!" });
    tenants.push(b.tenant.id);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { id: b.user.id } });
    ownerB = { identityId: bUser.identityId, company: (await prisma.company.findFirstOrThrow({ where: { tenantId: b.tenant.id } })).id };
  }, 120_000);

  afterAll(async () => {
    for (const t of tenants) await prisma.auditLog.deleteMany({ where: { tenantId: t } });
  });

  it("ranks an owner's companies across all their tenants by creation, and keeps another owner's same-named company apart", async () => {
    const sql = readFileSync(path.join(ROOT, "scripts/sql/subscription-migration-sizing.sql"), "utf8");
    const rows = (await prisma.$queryRawUnsafe<Row[]>(sql)).filter((r) => tenants.includes(r.tenant_id));
    const by = new Map(rows.map((r) => [r.company_id, r]));
    expect(rows).toHaveLength(4);

    // هوية المالك أ: ثلاث شركات في مستأجرين — الأقدم 1 (سعر كامل)، ثم 2، ثم 3
    expect([ownerA.first, ownerA.group, ownerA.independent].map((id) => n(by.get(id)!.owner_rank))).toEqual([1, 2, 3]);
    for (const id of [ownerA.first, ownerA.group, ownerA.independent]) {
      expect(by.get(id)!.owner_identity_id).toBe(ownerA.identityId);
      expect(n(by.get(id)!.owner_company_count)).toBe(3);
    }
    // المالك ب: شركته بنفس الاسم مستقلة الترتيب
    expect(by.get(ownerB.company)!.owner_identity_id).toBe(ownerB.identityId);
    expect([n(by.get(ownerB.company)!.owner_rank), n(by.get(ownerB.company)!.owner_company_count)]).toEqual([1, 1]);

    // المستخدمون لكل شركة: المالك (all) يُعدّ في شركتي مستأجره؛ المستخدم المقيَّد في شركته وحدها؛ المحذوف لا يُعدّ
    expect(n(by.get(ownerA.first)!.active_users)).toBe(1);
    expect(n(by.get(ownerA.group)!.active_users)).toBe(2);
    expect(n(by.get(ownerA.independent)!.active_users)).toBe(1);
    expect(n(by.get(ownerA.first)!.companies_in_tenant)).toBe(2);
  });
});
