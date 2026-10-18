import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { occupiedUserSeats } from "../../lib/subscriptionEnforcement";
import { createIndependentTenant, register } from "../auth/auth.service";
import { companySubscriptionsQuerySchema } from "../platformAdmin/platformAdmin.schemas";
import { COMPANY_LIST_DEFAULT_PAGE_SIZE, listCompanySubscriptions, setCompanySubscriptionStatus, upsertCompanySubscription } from "./subscriptionAdmin.service";
import { rankOwnerCompanies } from "./subscriptionPreview.service";

/**
 * قائمة الشركات في لوحة المدير مجمَّعة ومقسَّمة صفحات (مراجعة #164: كانت COUNT لكل شركة واستعلامات لكل مالك، متتابعة وبلا صفحات).
 * المرجع لكل صف هو المنطق السابق نفسه لكل شركة — occupiedUserSeats(tenant, company) وrankOwnerCompanies(identity) — على عيّنة
 * بعدة مالكين، ومالك بمستأجرين، وحالات اشتراك تغيّر "الحيّة" (منتهية قديمة، معلّقة)، وعضويات بكل نطاق وحالة. المستأجرون والشركات من
 * مسارات التسجيل الحقيقية؛ الاشتراكات من خدمة الإدارة نفسها.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const tag = `قائمة-${stamp}`;
const DAY = 86_400_000;

// عدّاد عمليات Prisma أثناء نداء واحد للقائمة — تحميل العلاقات (include/_count) داخل العملية الواحدة يجمعه Prisma باستعلام لكل مستوى
// علاقة لا لكل صف، فعدد العمليات الثابت يعني عدد استعلامات ثابتاً
let counting = false;
let operations = 0;
prisma.$use(async (params, next) => {
  if (counting) operations++;
  return next(params);
});
async function countOperations(fn: () => Promise<unknown>) {
  operations = 0;
  counting = true;
  try {
    await fn();
  } finally {
    counting = false;
  }
  return operations;
}

const term = (endDays: number) => {
  const end = new Date(Date.now() + endDays * DAY);
  return { currentPeriodStart: new Date(end.getTime() - 365 * DAY), currentPeriodEnd: end };
};

async function ownerWithCompanies(label: string, extra: number) {
  const r = await register({ tenantName: `${tag} ${label}`, businessActivity: "retail", name: `مالك ${label}`, email: `list-${label}-${stamp}@example.com`, password: "Str0ng-Pass!" });
  const first = (await prisma.company.findFirstOrThrow({ where: { tenantId: r.tenant.id } })).id;
  const ids = [first];
  for (let i = 0; i < extra; i++) {
    ids.push((await prisma.company.create({ data: { tenantId: r.tenant.id, name: `${tag} ${label} ${i}`, createdAt: new Date(Date.now() + (i + 1) * 1000) } })).id);
  }
  return { tenantId: r.tenant.id, ownerId: r.user.id, companyIds: ids };
}

async function member(tenantId: string, label: string, data: { companyScope: string; active?: boolean; deletedAt?: Date; inviteStatus?: "pending" | "accepted" }) {
  const identity = await prisma.identity.create({ data: { email: `list-m-${label}-${stamp}@example.com` } });
  await prisma.user.create({
    data: { tenantId, identityId: identity.id, name: label, role: "accountant", inviteStatus: data.inviteStatus ?? "accepted", companyScope: data.companyScope, active: data.active ?? true, deletedAt: data.deletedAt },
  });
}

/** الصف كما كان يحسبه المنطق السابق لكل شركة */
async function perCompanyReference(row: { companyId: string; tenant: { id: string } }) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: row.tenant.id }, select: { ownerId: true } });
  const owner = tenant.ownerId ? await prisma.user.findUnique({ where: { id: tenant.ownerId }, select: { identityId: true } }) : null;
  const ranks = owner ? await rankOwnerCompanies(owner.identityId) : [];
  return { occupied: await occupiedUserSeats(row.tenant.id, row.companyId), liveRank: ranks.find((r) => r.companyId === row.companyId)?.rank ?? null };
}

describe("platform-admin companies list: batched and paginated (review of #164)", () => {
  let x: Awaited<ReturnType<typeof ownerWithCompanies>>;
  let y: Awaited<ReturnType<typeof ownerWithCompanies>>;

  beforeAll(async () => {
    x = await ownerWithCompanies("x", 2);
    y = await ownerWithCompanies("y", 1);
    // مالك x بمستأجر ثانٍ (شركة مستقلة) — ترتيبه يمتد عبر المستأجرين
    const ind = await createIndependentTenant(x.ownerId, { name: `${tag} x مستقلة`, businessActivity: "retail" });
    await prisma.company.update({ where: { id: ind.company.id }, data: { createdAt: new Date(Date.now() + 10_000) } });
    const indTenantId = (await prisma.company.findUniqueOrThrow({ where: { id: ind.company.id } })).tenantId;
    await prisma.tenant.update({ where: { id: indTenantId }, data: { name: `${tag} x2` } });
    x.companyIds.push(ind.company.id);

    const [x1, x2, x3, xInd] = x.companyIds;
    // حالات تغيّر "الحيّة": منتهية منذ 60 يوماً (ليست حيّة)، معلّقة (ليست حيّة)، منتهية حديثاً (حيّة)
    await upsertCompanySubscription(x1, { plan: "basic", billingPeriod: "yearly", status: "active", ...term(30), enforced: false });
    await upsertCompanySubscription(x2, { plan: "professional", billingPeriod: "yearly", status: "expired", ...term(-60), enforced: false });
    await upsertCompanySubscription(x3, { plan: "basic", billingPeriod: "monthly", status: "active", ...term(30), enforced: false, extraUsers: 1 });
    await setCompanySubscriptionStatus(x3, "suspend", "اختبار القائمة"); // التعليق بمساره وحده (مراجعة #166)
    await upsertCompanySubscription(xInd, { plan: "enterprise", billingPeriod: "yearly", status: "expired", ...term(-3), enforced: false });
    await upsertCompanySubscription(y.companyIds[1], { plan: "basic", billingPeriod: "yearly", status: "trialing", ...term(10), enforced: false });
    // عضويات بكل نطاق وحالة — occupiedUserSeats يعدّ الدعوة المعلّقة ولا يعدّ المعطَّل ولا المحذوف
    await member(x.tenantId, "all", { companyScope: "all" });
    await member(x.tenantId, "x1", { companyScope: x1 });
    await member(x.tenantId, "x1-pending", { companyScope: x1, inviteStatus: "pending" });
    await member(x.tenantId, "x2-inactive", { companyScope: x2, active: false });
    await member(x.tenantId, "x2-deleted", { companyScope: x2, deletedAt: new Date() });
    await member(x.tenantId, "x3", { companyScope: x3 });
    await member(y.tenantId, "y1", { companyScope: y.companyIds[1] });
  }, 120_000);

  it("returns, for every company, the same seat count and live rank as the per-company logic", async () => {
    const list = await listCompanySubscriptions({ q: tag, pageSize: 200 });
    expect(list.total).toBe(6);
    expect(list.items.map((r) => r.companyId).sort()).toEqual([...x.companyIds, ...y.companyIds].sort());
    for (const row of list.items) {
      expect({ company: row.companyId, occupied: row.users.occupied, liveRank: row.liveRank }).toEqual({ company: row.companyId, ...(await perCompanyReference(row)) });
    }
    // العيّنة تمرّن الحالات فعلاً (لا تطابق تافه): رتب مختلفة، وشركات بلا رتبة، ومقاعد مختلفة
    const byId = new Map(list.items.map((r) => [r.companyId, r]));
    const [x1, x2, x3, xInd] = x.companyIds;
    expect([x1, x2, x3, xInd].map((id) => byId.get(id)!.liveRank)).toEqual([1, null, null, 2]);
    expect([x1, x2, x3].map((id) => byId.get(id)!.users.occupied)).toEqual([4, 2, 3]);
    expect(y.companyIds.map((id) => byId.get(id)!.liveRank)).toEqual([1, 2]);
  });

  it("paginates in a stable order: pages concatenate to the full list with no repeat or gap; default and bounds", async () => {
    const full = (await listCompanySubscriptions({ q: tag, pageSize: 200 })).items.map((r) => r.companyId);
    const paged: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const p = await listCompanySubscriptions({ q: tag, page, pageSize: 2 });
      expect([p.page, p.pageSize, p.total]).toEqual([page, 2, 6]);
      paged.push(...p.items.map((r) => r.companyId));
    }
    expect(paged).toEqual(full);
    expect((await listCompanySubscriptions({ q: tag, page: 4, pageSize: 2 })).items).toEqual([]);
    expect((await listCompanySubscriptions({ q: tag })).pageSize).toBe(COMPANY_LIST_DEFAULT_PAGE_SIZE);
    // مخطط الطلب: صفحات من نص الاستعلام، وحد أعلى لحجم الصفحة
    expect(companySubscriptionsQuerySchema.parse({ page: "2", pageSize: "25" })).toMatchObject({ page: 2, pageSize: 25 });
    expect(companySubscriptionsQuerySchema.safeParse({ pageSize: "201" }).success).toBe(false);
    expect(companySubscriptionsQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });

  it("runs the same number of queries whatever the number of companies and owners on the page", async () => {
    const list = () => listCompanySubscriptions({ q: tag, pageSize: 200 });
    const before = await countOperations(list);
    // ضعف الشركات تقريباً، ومالك ثالث جديد بشركتين
    for (let i = 0; i < 4; i++) await prisma.company.create({ data: { tenantId: x.tenantId, name: `${tag} x إضافية ${i}` } });
    await ownerWithCompanies("z", 1);
    expect((await list()).total).toBe(12);
    const after = await countOperations(list);
    expect(after).toBe(before);
    expect(before).toBeLessThanOrEqual(8);
  });
});
