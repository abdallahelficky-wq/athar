import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken } from "../../lib/jwt";
import { hashPassword } from "../../lib/password";
import { clearSubscriptionEnforcementCache } from "../../lib/subscriptionEnforcement";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
import { setCompanyPosUsers, setEnforcementSwitch, upsertCompanySubscription } from "./subscriptionAdmin.service";

/**
 * الإنفاذ على الخادم (P4، docs/design/subscription-plans.md §5) عبر مسارات HTTP الحقيقية على Postgres فعلي. المستأجر بشركتين: A تُنفَّذ
 * عليها الباقة، وB بلا صف اشتراك — يجب أن تبقى B كما هي اليوم في كل حالة. الإعداد عبر خدمة إدارة الاشتراك نفسها (التي تخدم مسارات
 * لوحة مدير المنصة)، لا بكتابة صفوف يدوية. المفتاح الشامل يُعاد إلى "معطّل" في النهاية.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const DAY = 86_400_000;
const email = `enf-owner-${stamp}@example.com`;
let server: Server;
let baseUrl = "";
let ownerToken = "";
let ownerId = "";
let tenantId = "";
let companyA = "";
let companyB = "";
const acc: Record<string, string> = {};
const PIN = "4826";

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, text, code: parsed?.details?.code as string | undefined };
}

/** يضبط اشتراك A بحسب الحالة المطلوبة ويفرغ الذاكرة المؤقتة (كما تفعل الخدمة نفسها) */
async function subscribeA(over: Partial<Parameters<typeof upsertCompanySubscription>[1]> & { endDays?: number } = {}) {
  const { endDays = 30, ...rest } = over;
  const end = new Date(Date.now() + endDays * DAY);
  await upsertCompanySubscription(companyA, {
    plan: "basic",
    billingPeriod: "yearly",
    status: "active",
    currentPeriodStart: new Date(end.getTime() - 365 * DAY),
    currentPeriodEnd: end,
    enforced: true,
    ...rest,
  });
}
async function globalSwitch(enabled: boolean) {
  await setEnforcementSwitch(enabled);
  clearSubscriptionEnforcementCache();
}
const journal = (companyId: string, key: "A" | "B") =>
  call("POST", "/journal-entries", ownerToken, {
    companyId, date: "2026-10-12T09:00:00.000Z", memo: "قيد اختبار الإنفاذ", post: false,
    lines: [{ accountId: acc[`cash${key}`], debit: 10, credit: 0 }, { accountId: acc[`rev${key}`], debit: 0, credit: 10 }],
  });
const warehouse = (companyId: string) => call("POST", "/warehouses", ownerToken, { companyId, name: `مستودع ${Math.random().toString(36).slice(2, 8)}` });

describe("subscription enforcement (P4)", () => {
  beforeAll(async () => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await register({ tenantName: `إنفاذ الباقات ${stamp}`, businessActivity: "retail", name: "المالك", email, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    ownerToken = r.accessToken;
    ownerId = r.user.id;
    companyA = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;
    const other = await call("POST", "/companies", ownerToken, { name: `الشركة ب ${stamp}`, businessActivity: "retail" });
    expect(other.status, other.text).toBe(201);
    companyB = other.body.id;
    await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: await hashPassword(PIN) } });
    for (const [key, companyId] of [["A", companyA], ["B", companyB]] as const) {
      acc[`cash${key}`] = (await prisma.account.findFirstOrThrow({ where: { companyId, code: "111001" } })).id;
      acc[`rev${key}`] = (await prisma.account.findFirstOrThrow({ where: { companyId, type: "revenue", isPosting: true } })).id;
    }
  }, 120_000);

  afterAll(async () => {
    await globalSwitch(false);
    server?.close();
  });

  it("with the global switch OFF, an enforced read-only basic company behaves exactly as today", async () => {
    await globalSwitch(false);
    await subscribeA({ endDays: -30 }); // منتهية منذ شهر، باقة أساسية، enforced=true
    expect((await journal(companyA, "A")).status).toBe(201);
    expect((await warehouse(companyA)).status).toBe(201); // المستودعات خارج الأساسية — لا أثر والمفتاح معطّل
  });

  it("with the switch ON, a company without an enforced row (B) behaves exactly as today", async () => {
    await globalSwitch(true);
    await subscribeA({ endDays: 30 });
    expect((await journal(companyB, "B")).status).toBe(201);
    expect((await warehouse(companyB)).status).toBe(201);
    expect((await call("POST", "/customers", ownerToken, { companyId: companyB, name: "عميل ب" })).status).toBe(201);
  });

  it("refuses writes to a module outside the plan, for the owner too, with the upgrade message", async () => {
    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: 30 });
    const refused = await warehouse(companyA);
    expect(refused.status).toBe(403);
    expect(refused.code).toBe("plan_module_not_included");
    expect(refused.body.error).toContain("غير مشمولة في باقة الشركة الحالية");
    expect(refused.body.error).toContain("ترقية الباقة");
    expect(refused.body.details).toMatchObject({ moduleId: "warehouses", plan: "basic" });
    // معرّف سجل بلا companyId في الطلب: يلتقطه حارس طبقة البيانات (المستودع الافتراضي في A)
    const defaultWarehouse = await prisma.warehouse.findFirstOrThrow({ where: { companyId: companyA } });
    const patch = await call("PATCH", `/warehouses/${defaultWarehouse.id}`, ownerToken, { name: "تعديل مرفوض" });
    expect([patch.status, patch.code]).toEqual([403, "plan_module_not_included"]);
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: defaultWarehouse.id } })).name).toBe(defaultWarehouse.name);
  });

  it("keeps reads, reports and exports of a module outside the plan open (D31)", async () => {
    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: 30 });
    const list = await call("GET", `/warehouses?companyId=${companyA}`, ownerToken);
    expect(list.status, list.text).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2); // ما أُنشئ قبل الإنفاذ ما زال ظاهراً
    expect((await call("GET", `/inventory-reports/stock-report?companyId=${companyA}`, ownerToken)).status).toBe(200);
    expect((await call("GET", `/fixed-assets?companyId=${companyA}`, ownerToken)).status).toBe(200);
  });

  it("allows writes the plan includes, and leaves the other company in the same tenant untouched", async () => {
    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: 30 });
    expect((await journal(companyA, "A")).status).toBe(201);
    expect((await call("POST", "/customers", ownerToken, { companyId: companyA, name: "عميل أ" })).status).toBe(201);
    expect((await warehouse(companyB)).status).toBe(201);
    // ترقية A إلى الاحترافية تفتح المستودعات
    await subscribeA({ plan: "professional", endDays: 30 });
    expect((await warehouse(companyA)).status).toBe(201);
  });

  it("follows the dates: grace keeps writing, read-only after 7 days, trials and suspended stop at once — reads always pass", async () => {
    await globalSwitch(true);
    await subscribeA({ endDays: -3 }); // فترة سماح
    expect((await journal(companyA, "A")).status).toBe(201);

    await subscribeA({ endDays: -8 }); // بعد السماح
    const ro = await journal(companyA, "A");
    expect([ro.status, ro.code]).toEqual([403, "subscription_read_only"]);
    expect(ro.body.error).toContain("عرض فقط");
    expect((await call("GET", `/journal-entries?companyId=${companyA}`, ownerToken)).status).toBe(200);
    expect((await call("GET", `/inventory-reports/stock-report?companyId=${companyA}`, ownerToken)).status).toBe(200);
    expect((await journal(companyB, "B")).status).toBe(201); // B لا تتأثر

    // إعدادات الشركة نفسها (صف companies بمعرّفه في المسار) — يلتقطها حارس طبقة البيانات
    const rename = await call("PATCH", `/companies/${companyA}`, ownerToken, { name: "اسم جديد مرفوض" });
    expect([rename.status, rename.code]).toEqual([403, "subscription_read_only"]);
    expect((await call("PATCH", `/companies/${companyB}`, ownerToken, { name: `الشركة ب ${stamp}` })).status).toBe(200);

    await subscribeA({ status: "trialing", endDays: -1 }); // التجربة بلا سماح
    expect((await journal(companyA, "A")).code).toBe("subscription_read_only");
    await subscribeA({ status: "trialing", endDays: 5 });
    expect((await journal(companyA, "A")).status).toBe(201);
    await subscribeA({ status: "suspended", endDays: 100 });
    expect((await journal(companyA, "A")).code).toBe("subscription_suspended");
  });

  it("refuses a mirror entry into a read-only company and writes nothing in either company", async () => {
    await globalSwitch(true);
    await subscribeA({ endDays: 30 });
    const source = await journal(companyB, "B");
    expect(source.status).toBe(201);
    await subscribeA({ endDays: -8 });
    const before = await prisma.journalEntry.count({ where: { companyId: companyA } });
    const mirror = await call("POST", `/journal-entries/${source.body.id}/mirror`, ownerToken, {
      targetCompanyId: companyA, date: "2026-10-12T09:00:00.000Z",
      lines: [{ accountId: acc.cashA, debit: 10, credit: 0 }, { accountId: acc.revA, debit: 0, credit: 10 }],
    });
    expect([mirror.status, mirror.code]).toEqual([403, "subscription_read_only"]);
    expect(await prisma.journalEntry.count({ where: { companyId: companyA } })).toBe(before);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: source.body.id } })).mirrorEntryId).toBeNull();
  });

  it("refuses reversing an entry in a read-only company, and reversing the mirror half that lives there; the other half stays reversible", async () => {
    await globalSwitch(true);
    await subscribeA({ endDays: 30 });
    const own = await call("POST", "/journal-entries", ownerToken, {
      companyId: companyA, date: "2026-10-12T09:00:00.000Z", memo: "قيد A مرحّل", post: true,
      lines: [{ accountId: acc.cashA, debit: 7, credit: 0 }, { accountId: acc.revA, debit: 0, credit: 7 }],
    });
    expect(own.status, own.text).toBe(201);
    const source = await call("POST", "/journal-entries", ownerToken, {
      companyId: companyB, date: "2026-10-12T09:00:00.000Z", memo: "مصدر مرآة", post: true,
      lines: [{ accountId: acc.cashB, debit: 9, credit: 0 }, { accountId: acc.revB, debit: 0, credit: 9 }],
    });
    const mirror = await call("POST", `/journal-entries/${source.body.id}/mirror`, ownerToken, {
      targetCompanyId: companyA, date: "2026-10-12T09:00:00.000Z",
      lines: [{ accountId: acc.cashA, debit: 9, credit: 0 }, { accountId: acc.revA, debit: 0, credit: 9 }],
    });
    expect(mirror.status, mirror.text).toBe(201);

    await subscribeA({ endDays: -8 });
    const countA = await prisma.journalEntry.count({ where: { companyId: companyA } });
    const reverseOwn = await call("POST", `/journal-entries/${own.body.id}/reverse`, ownerToken, { date: "2026-10-13T09:00:00.000Z" });
    expect([reverseOwn.status, reverseOwn.code]).toEqual([403, "subscription_read_only"]);
    const reverseMirror = await call("POST", `/journal-entries/${mirror.body.id}/reverse`, ownerToken, { date: "2026-10-13T09:00:00.000Z" });
    expect([reverseMirror.status, reverseMirror.code]).toEqual([403, "subscription_read_only"]);
    expect(await prisma.journalEntry.count({ where: { companyId: companyA } })).toBe(countA);
    // نصف B يُعكَس في B وحدها — B لا تتأثر بحالة A
    expect((await call("POST", `/journal-entries/${source.body.id}/reverse`, ownerToken, { date: "2026-10-13T09:00:00.000Z" })).status).toBe(201);
  });

  it("refuses un-posting a pair from the healthy company when that would change the half in the read-only company (no companyId in the request)", async () => {
    await globalSwitch(true);
    await subscribeA({ endDays: 30 });
    const source = await call("POST", "/journal-entries", ownerToken, {
      companyId: companyB, date: "2026-10-12T09:00:00.000Z", memo: "زوج للفك", post: true,
      lines: [{ accountId: acc.cashB, debit: 4, credit: 0 }, { accountId: acc.revB, debit: 0, credit: 4 }],
    });
    const mirror = await call("POST", `/journal-entries/${source.body.id}/mirror`, ownerToken, {
      targetCompanyId: companyA, date: "2026-10-12T09:00:00.000Z",
      lines: [{ accountId: acc.cashA, debit: 4, credit: 0 }, { accountId: acc.revA, debit: 0, credit: 4 }],
    });
    expect(mirror.status, mirror.text).toBe(201);
    await subscribeA({ endDays: -8 });
    const unpost = await call("POST", `/journal-entries/${source.body.id}/unpost`, ownerToken, { pin: PIN });
    expect([unpost.status, unpost.code]).toEqual([403, "subscription_read_only"]);
    const [src, mir] = await Promise.all([source.body.id, mirror.body.id].map((id: string) => prisma.journalEntry.findUniqueOrThrow({ where: { id } })));
    expect([src.status, mir.status]).toEqual(["posted", "posted"]);
  });

  it("blocks only new seats when the user limit is reached: invites, re-activation and moving a scope in", async () => {
    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: 30 }); // حد 2: المالك (all) + واحد
    const invite = (tag: string, companyScope: string) =>
      call("POST", "/auth/invite", ownerToken, { name: `عضو ${tag}`, email: `enf-${tag}-${stamp}@example.com`, role: "accountant", companyScope });
    const first = await invite("a1", companyA);
    expect(first.status, first.text).toBe(201);
    const second = await invite("a2", companyA);
    expect([second.status, second.code]).toEqual([403, "user_limit_reached"]);
    expect((await invite("all1", "all")).code).toBe("user_limit_reached"); // "all" يشغل مقعداً في A
    expect((await invite("b1", companyB)).status).toBe(201); // B بلا حد

    // التعطيل مسموح دائماً، وإعادة التفعيل فوق الحد مرفوضة
    expect((await call("PATCH", `/auth/users/${first.body.id}/active`, ownerToken, { active: false })).status).toBe(200);
    expect((await invite("a3", companyA)).status).toBe(201);
    const reactivate = await call("PATCH", `/auth/users/${first.body.id}/active`, ownerToken, { active: true });
    expect([reactivate.status, reactivate.code]).toEqual([403, "user_limit_reached"]);
    // نقل نطاق عضو B إلى A فوق الحد مرفوض؛ والأعضاء القائمون لا يُخرَجون
    const bUser = await prisma.user.findFirstOrThrow({ where: { tenantId, companyScope: companyB } });
    expect((await call("PATCH", `/auth/users/${bUser.id}`, ownerToken, { companyScope: companyA })).code).toBe("user_limit_reached");
    expect((await journal(companyA, "A")).status).toBe(201);
    // مستخدم إضافي مشترى يرفع الحد
    await subscribeA({ plan: "basic", endDays: 30, extraUsers: 1 });
    expect((await call("PATCH", `/auth/users/${first.body.id}/active`, ownerToken, { active: true })).status).toBe(200);
  });

  it("requires an explicit POS assignment to open POS sales — the owner included (D19, D27)", async () => {
    await globalSwitch(true);
    const sale = () => call("POST", "/pos/sales", ownerToken, { companyId: companyA, lines: [] });
    await subscribeA({ plan: "basic", endDays: 30 });
    expect((await sale()).code).toBe("plan_module_not_included"); // نقطة البيع غير مفعّلة
    await subscribeA({ plan: "basic", endDays: 30, posEnabled: true });
    const unassigned = await sale();
    expect([unassigned.status, unassigned.code]).toEqual([403, "pos_seat_required"]);
    await setCompanyPosUsers(companyA, [ownerId]);
    const assigned = await sale();
    expect(assigned.code).toBeUndefined(); // تجاوز الإنفاذ ووصل إلى التحقق من الطلب نفسه
    expect(assigned.status).toBe(400);
    // المقعد الثاني يحتاج مقعداً إضافياً مدفوعاً
    const scoped = await prisma.user.findFirstOrThrow({ where: { tenantId, companyScope: companyA, active: true } });
    await expect(setCompanyPosUsers(companyA, [ownerId, scoped.id])).rejects.toThrow("لا توجد مقاعد نقطة بيع متاحة");
  });

  it("applies to a company-scoped user through their scope, without a companyId in the URL", async () => {
    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: -8 });
    const scoped = await prisma.user.findFirstOrThrow({ where: { tenantId, companyScope: companyA, active: true } });
    await prisma.user.update({ where: { id: scoped.id }, data: { inviteStatus: "accepted", role: "admin" } });
    const token = signAccessToken({ sub: scoped.id, tenantId, role: "admin", companyScope: companyA, readOnly: false });
    const res = await call("POST", "/customers", token, { companyId: companyA, name: "عميل المقيَّد" });
    expect([res.status, res.code]).toEqual([403, "subscription_read_only"]);
  });

  it("turning the global switch OFF again restores today's behaviour for the enforced company", async () => {
    await subscribeA({ plan: "basic", endDays: -30, posEnabled: false });
    await globalSwitch(false);
    expect((await journal(companyA, "A")).status).toBe(201);
    expect((await warehouse(companyA)).status).toBe(201);
  });
});
