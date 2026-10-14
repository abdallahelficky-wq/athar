import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// الخدمات الخارجية مستبدلة بجواسيس — لا نداء حقيقي لزاتكا أو البريد أو Claude. الاختبارات تثبت أنها لا تُستدعى إطلاقاً لشركة
// مُنفَّذة ممنوعة (مراجعة #163: الرفض يجب أن يسبق النداء الخارجي، لا أن يأتي بعده من حارس الكتابة).
vi.mock("../../lib/zatca/apiClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestComplianceCsid: vi.fn(async () => ({ status: 500, data: null })),
  requestProductionCsid: vi.fn(async () => ({ status: 500, data: null })),
  checkInvoiceCompliance: vi.fn(async () => ({ status: 500, data: null })),
  reportInvoice: vi.fn(async () => ({ status: 500, data: null })),
  clearInvoice: vi.fn(async () => ({ status: 500, data: null })),
}));
vi.mock("../../lib/mailer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendReportDigestEmail: vi.fn(async () => undefined),
  sendInviteEmail: vi.fn(async () => undefined),
  sendInvoiceEmail: vi.fn(async () => undefined),
  sendCreditNoteEmail: vi.fn(async () => undefined),
  sendLiveryContractEmail: vi.fn(async () => undefined),
}));
vi.mock("../../lib/claudeVision", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  extractJournalEntryFromDocument: vi.fn(async () => {
    throw new Error("stub");
  }),
  extractCompanyDataFromDocument: vi.fn(async () => {
    throw new Error("stub");
  }),
}));
// التخزين الخارجي (مراجعة #163): مسارات المرفقات المرفوضة لا تمسّه إطلاقاً
vi.mock("../../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  getPresignedGetUrl: vi.fn(async () => "https://storage.invalid/test"),
}));
vi.mock("../ai/ai.service", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  askAtharAi: vi.fn(async () => ({ answer: "stub" })),
}));
import * as zatcaClient from "../../lib/zatca/apiClient";
import * as mailer from "../../lib/mailer";
import * as vision from "../../lib/claudeVision";
import * as aiService from "../ai/ai.service";
import * as storage from "../../lib/storage";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { signAccessToken, signEmployeePortalToken } from "../../lib/jwt";
import { runWithRequestContext } from "../../lib/requestContext";
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
async function callForm(path: string, token: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }), "doc.png");
  const res = await fetch(`${baseUrl}/api${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, text, code: parsed?.details?.code as string | undefined };
}
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    // تنظيف: الاختبارات التالية تعيد الاشتراك بلا نقطة بيع، وإيقافها لا يترك تعيينات فوق السعة (مراجعة #163)
    await setCompanyPosUsers(companyA, []);
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

  // ── مراجعة #163 (1): المسارات التي تستدعي خدمة خارجية تُرفَض قبل النداء ──────────────────────────────────────
  it("refuses ZATCA onboarding for an enforced read-only company before any ZATCA call (routes where :id is the company)", async () => {
    await globalSwitch(true);
    await subscribeA({ plan: "enterprise", endDays: 30 });
    const vat = await call("PATCH", `/companies/${companyA}`, ownerToken, { vatNumber: "310123456700003", crNumber: "1010123456" });
    expect(vat.status, vat.text).toBe(200);
    const csr = await call("POST", `/companies/${companyA}/zatca/csr`, ownerToken, {});
    expect(csr.status, csr.text).toBeLessThan(300); // CSR محلي بلا شبكة — حتى يصل طلب الشهادة فعلاً إلى عميل زاتكا لولا الفحص
    await subscribeA({ plan: "enterprise", endDays: -8 });
    for (const [path, body] of [["/compliance", { otp: "123456" }], ["/production", {}], ["/compliance-steps/standard_invoice/test", {}]] as const) {
      const res = await call("POST", `/companies/${companyA}/zatca${path}`, ownerToken, body);
      expect([path, res.status, res.code]).toEqual([path, 403, "subscription_read_only"]);
    }
    expect(zatcaClient.requestComplianceCsid).not.toHaveBeenCalled();
    expect(zatcaClient.requestProductionCsid).not.toHaveBeenCalled();
    expect(zatcaClient.checkInvoiceCompliance).not.toHaveBeenCalled();
  });

  it("refuses Claude extraction and report email for an enforced read-only company before the external call — multipart bodies included", async () => {
    await globalSwitch(true);
    await subscribeA({ plan: "enterprise", endDays: 30 });
    const customer = await call("POST", "/customers", ownerToken, { companyId: companyA, name: "عميل للاستخراج" });
    expect(customer.status).toBe(201);
    await subscribeA({ plan: "enterprise", endDays: -8 });

    const company = await callForm(`/companies/${companyA}/extract-document`, ownerToken, { docType: "cr" });
    expect([company.status, company.code]).toEqual([403, "subscription_read_only"]);
    const cust = await callForm(`/customers/${customer.body.id}/extract-document`, ownerToken, { docType: "cr" });
    expect([cust.status, cust.code]).toEqual([403, "subscription_read_only"]);
    const journal = await callForm("/journal-entries/from-document", ownerToken, { companyId: companyA });
    expect([journal.status, journal.code]).toEqual([403, "subscription_read_only"]);
    const digest = await call("POST", `/companies/${companyA}/report-schedule/send-now`, ownerToken, {});
    expect([digest.status, digest.code]).toEqual([403, "subscription_read_only"]);
    expect(vision.extractCompanyDataFromDocument).not.toHaveBeenCalled();
    expect(vision.extractJournalEntryFromDocument).not.toHaveBeenCalled();
    expect(mailer.sendReportDigestEmail).not.toHaveBeenCalled();

    // B غير مُنفَّذة: المسار نفسه يصل إلى الاستخراج (الجاسوس يُستدعى) — الفحص لا يحجب غيرها
    await callForm("/journal-entries/from-document", ownerToken, { companyId: companyB });
    expect(vision.extractJournalEntryFromDocument).toHaveBeenCalledTimes(1);
  });

  it("gates Athar AI as a feature by plan and read-only — even a tenant-wide question without companyId", async () => {
    await globalSwitch(true);
    const ask = (body: Record<string, unknown>) => call("POST", "/ai/ask", ownerToken, { question: "ما صافي الربح؟", ...body });
    await subscribeA({ plan: "basic", endDays: 30 });
    expect((await ask({ companyId: companyA })).code).toBe("plan_module_not_included");
    expect((await ask({})).code).toBe("plan_module_not_included");
    await subscribeA({ plan: "enterprise", endDays: -8 });
    expect((await ask({ companyId: companyA })).code).toBe("subscription_read_only");
    expect(aiService.askAtharAi).not.toHaveBeenCalled();
    await subscribeA({ plan: "enterprise", endDays: 30 });
    const ok = await ask({ companyId: companyA });
    expect(ok.code, ok.text).toBeUndefined();
    expect(aiService.askAtharAi).toHaveBeenCalledTimes(1);
  });

  // ── مراجعة #163 (2): إضافة المحطات على باقة بلا موارد بشرية = عمّال المحطات فقط (D20) ─────────────────────────────
  it("limits employee writes to station workers on a plan without HR, while reads stay open", async () => {
    await globalSwitch(true);
    await subscribeA({ plan: "enterprise", endDays: 30 });
    const station = await call("POST", "/cost-centers", ownerToken, { companyId: companyA, name: `محطة ${stamp}` });
    expect(station.status, station.text).toBe(201);
    const employee = (extra: Record<string, unknown>) =>
      call("POST", "/employees", ownerToken, { companyId: companyA, name: `موظف ${Math.random().toString(36).slice(2, 7)}`, hireDate: "2026-01-01", basicSalary: 3000, ...extra });
    const office = await employee({}); // موظف مكتب أُنشئ على المؤسسية
    expect(office.status, office.text).toBe(201);
    const worker = await employee({ assignedCostCenterId: station.body.id });
    expect(worker.status, worker.text).toBe(201);

    await subscribeA({ plan: "basic", endDays: 30, stationsAddon: "free" });
    const refused = await employee({});
    expect([refused.status, refused.code]).toEqual([403, "station_workers_only"]);
    expect(refused.body.error).toContain("عمّال المحطات");
    expect((await call("POST", "/employees/import", ownerToken, { companyId: companyA, rows: [{ name: "مستورد", hireDate: "2026-01-01", basicSalary: 2000 }] })).code).toBe("station_workers_only");
    expect((await call("PATCH", `/employees/${office.body.id}`, ownerToken, { name: "تعديل موظف مكتب" })).code).toBe("station_workers_only");
    expect((await call("DELETE", `/employees/${office.body.id}`, ownerToken)).code).toBe("station_workers_only");
    expect((await call("PATCH", `/employees/${worker.body.id}`, ownerToken, { assignedCostCenterId: null })).code).toBe("station_workers_only");

    expect((await employee({ assignedCostCenterId: station.body.id })).status).toBe(201);
    expect((await call("PATCH", `/employees/${worker.body.id}`, ownerToken, { name: "عامل محطة معدَّل" })).status).toBe(200);
    const list = await call("GET", `/employees?companyId=${companyA}`, ownerToken);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(office.body.id); // القراءة غير مقيَّدة (D31)
    expect(await prisma.employee.count({ where: { id: office.body.id } })).toBe(1); // الحذف المرفوض لم يمسّه

    // بلا إضافة المحطات: لا موظفين إطلاقاً على الأساسية
    await subscribeA({ plan: "basic", endDays: 30, stationsAddon: "off" });
    expect((await employee({ assignedCostCenterId: station.body.id })).code).toBe("plan_module_not_included");
  });

  // ── مراجعة #163 (3): آخر مقعد لا يُمنح مرتين ─────────────────────────────────────────────────────────────────
  it("gives the last user seat to exactly one of several concurrent requests (invite, re-activation)", async () => {
    await globalSwitch(true);
    const occupied = await prisma.user.count({ where: { tenantId, active: true, deletedAt: null, companyScope: { in: ["all", companyA] } } });
    await subscribeA({ plan: "basic", endDays: 30, extraUsers: occupied + 1 - 2 }); // مقعد واحد متبقٍّ
    const invites = await Promise.all(
      [1, 2, 3, 4].map((i) => call("POST", "/auth/invite", ownerToken, { name: `سباق ${i}`, email: `enf-race${i}-${stamp}@example.com`, role: "accountant", companyScope: companyA })),
    );
    expect(invites.filter((r) => r.status === 201)).toHaveLength(1);
    expect(invites.filter((r) => r.code === "user_limit_reached")).toHaveLength(3);
    expect(await prisma.user.count({ where: { tenantId, active: true, deletedAt: null, companyScope: { in: ["all", companyA] } } })).toBe(occupied + 1);

    // إعادة تفعيل متزامنة لعضوين معطَّلين على مقعد واحد
    const winner = invites.find((r) => r.status === 201)!;
    const second = await prisma.user.findFirstOrThrow({ where: { tenantId, companyScope: companyA, active: true, id: { not: winner.body.id }, deletedAt: null, NOT: { id: ownerId } } });
    for (const id of [winner.body.id, second.id]) expect((await call("PATCH", `/auth/users/${id}/active`, ownerToken, { active: false })).status).toBe(200);
    const occupiedNow = await prisma.user.count({ where: { tenantId, active: true, deletedAt: null, companyScope: { in: ["all", companyA] } } });
    await subscribeA({ plan: "basic", endDays: 30, extraUsers: occupiedNow + 1 - 2 });
    const reactivations = await Promise.all([winner.body.id, second.id].map((id) => call("PATCH", `/auth/users/${id}/active`, ownerToken, { active: true })));
    expect(reactivations.map((r) => r.status).sort()).toEqual([200, 403]);
  });

  // ── مراجعة #164 (1): بوابة الموظف تخضع لاشتراك شركة الموظف ─────────────────────────────────────────────────────────
  it("refuses employee-portal writes for an enforced read-only or suspended company; portal reads still work; other companies unchanged", async () => {
    await globalSwitch(false);
    const portalEmployee = async (companyId: string, label: string) => {
      const e = await prisma.employee.create({
        data: { tenantId, companyId, name: `موظف البوابة ${label}`, hireDate: new Date("2026-01-01"), basicSalary: 1000, portalActive: true },
      });
      return { id: e.id, token: signEmployeePortalToken({ employeeId: e.id, tenantId }) };
    };
    const eA = await portalEmployee(companyA, "أ");
    const eB = await portalEmployee(companyB, "ب");
    const leave = (token: string) =>
      call("POST", "/employee-portal/leave-requests", token, { type: "annual", startDate: "2026-11-01", endDate: "2026-11-03" });

    await globalSwitch(true);
    await subscribeA({ plan: "enterprise", endDays: -30 }); // منتهية: "عرض فقط"
    const checkIn = await call("POST", "/attendance/check-in", eA.token);
    expect([checkIn.status, checkIn.code]).toEqual([403, "subscription_read_only"]);
    expect((await leave(eA.token)).code).toBe("subscription_read_only");
    expect(await prisma.attendanceRecord.count({ where: { employeeId: eA.id } })).toBe(0);
    expect(await prisma.leaveRequest.count({ where: { employeeId: eA.id } })).toBe(0);
    // القراءة تمرّ
    expect((await call("GET", "/employee-portal/me", eA.token)).status).toBe(200);
    expect((await call("GET", "/attendance/me", eA.token)).status).toBe(200);
    expect((await call("GET", "/employee-portal/leave-requests", eA.token)).status).toBe(200);
    // شركة بلا صف مُنفَّذ في المستأجر نفسه: كما اليوم
    expect((await call("POST", "/attendance/check-in", eB.token)).status).toBe(201);
    expect((await leave(eB.token)).status).toBe(201);

    await subscribeA({ plan: "enterprise", status: "suspended", endDays: 30 });
    expect((await call("POST", "/attendance/check-in", eA.token)).code).toBe("subscription_suspended");

    await subscribeA({ plan: "enterprise", endDays: 30 }); // مُنفَّذة وسارية: تكتب
    expect((await call("POST", "/attendance/check-in", eA.token)).status).toBe(201);

    // المفتاح معطّل: شركة "عرض فقط" مُنفَّذة تعود كما اليوم
    await subscribeA({ plan: "enterprise", endDays: -30 });
    await globalSwitch(false);
    expect((await leave(eA.token)).status).toBe(201);
  });

  // ── مراجعة #164 (2): جداول بلا companyId تُحلّ شركتها عبر أصلها ─────────────────────────────────────────────────────
  it("guards employee payroll components through the employee's company: read-only and a plan without payroll settings", async () => {
    await globalSwitch(false);
    const employee = await prisma.employee.create({
      data: { tenantId, companyId: companyA, name: "موظف الرواتب", hireDate: new Date("2026-01-01"), basicSalary: 3000 },
    });
    const expense = await prisma.account.findFirstOrThrow({ where: { companyId: companyA, type: "expense", isPosting: true } });
    const created = await call("POST", `/companies/${companyA}/payroll-components`, ownerToken, {
      name: "بدل اختبار", kind: "addition", accountId: expense.id, calcMethod: "fixed", appliesByDefault: false,
    });
    expect(created.status, created.text).toBe(201);
    const component = created.body;
    const put = () => call("PUT", `/employees/${employee.id}/payroll-components`, ownerToken, [{ componentId: component.id, isActive: true, fixedValue: 250 }]);

    await globalSwitch(true);
    await subscribeA({ plan: "enterprise", endDays: -30 });
    const readOnly = await put();
    expect([readOnly.status, readOnly.code], readOnly.text).toEqual([403, "subscription_read_only"]);

    for (const plan of ["basic", "professional"] as const) {
      await subscribeA({ plan, endDays: 30 });
      const refused = await put();
      expect([refused.status, refused.code], `${plan}: ${refused.text}`).toEqual([403, "plan_module_not_included"]);
      expect(refused.body.details).toMatchObject({ moduleId: "payrollSettings" });
    }
    expect(await prisma.employeePayrollComponent.count({ where: { employeeId: employee.id } })).toBe(0);

    await subscribeA({ plan: "enterprise", endDays: 30 });
    const allowed = await put();
    expect(allowed.status, allowed.text).toBe(200);
    expect(await prisma.employeePayrollComponent.count({ where: { employeeId: employee.id } })).toBe(1);
  });

  it("guards line items and attachments written on their own through their parent record (backstop)", async () => {
    await globalSwitch(false);
    const entryA = await journal(companyA, "A");
    const entryB = await journal(companyB, "B");
    expect([entryA.status, entryB.status]).toEqual([201, 201]);
    // استعلام Prisma كسول: يُنفَّذ عند await — فيجب أن يكون await داخل سياق الطلب، كما في معالج حقيقي
    const asOwner = <T>(fn: () => PromiseLike<T>) =>
      runWithRequestContext({ tenantId, userId: ownerId, method: "POST", writeResources: new Set<string>() }, async () => await fn());
    const line = (entryId: string, accountId: string) =>
      asOwner(() => prisma.journalEntryLine.create({ data: { journalEntryId: entryId, accountId, debit: 1, credit: 0 } }));
    const attach = (entryId: string) =>
      asOwner(() =>
        prisma.attachment.create({
          data: { tenantId, entityType: "journal_entry", entityId: entryId, fileName: "f.pdf", fileKey: `k-${entryId}`, fileSize: 1, mimeType: "application/pdf" },
        }),
      );

    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: -30 });
    const linesBefore = await prisma.journalEntryLine.count({ where: { journalEntryId: entryA.body.id } });
    await expect(line(entryA.body.id, acc.cashA)).rejects.toMatchObject({ status: 403, details: { code: "subscription_read_only" } });
    await expect(asOwner(() => prisma.journalEntryLine.deleteMany({ where: { journalEntryId: entryA.body.id } }))).rejects.toMatchObject({
      details: { code: "subscription_read_only" },
    });
    await expect(attach(entryA.body.id)).rejects.toMatchObject({ details: { code: "subscription_read_only" } });
    expect(await prisma.journalEntryLine.count({ where: { journalEntryId: entryA.body.id } })).toBe(linesBefore);
    expect(await prisma.attachment.count({ where: { entityId: entryA.body.id } })).toBe(0);

    // الشركة الأخرى بلا صف مُنفَّذ: الكتابة نفسها تمرّ
    const okLine = await line(entryB.body.id, acc.cashB);
    const okAttachment = await attach(entryB.body.id);
    await prisma.journalEntryLine.delete({ where: { id: okLine.id } });
    await prisma.attachment.delete({ where: { id: okAttachment.id } });
  });

  // ── مراجعة #163/#164 (1): المرفقات تُرفَض قبل أي عملية تخزين ─────────────────────────────────────────────────────
  it("refuses attachment upload and delete for an enforced read-only company before touching object storage", async () => {
    await globalSwitch(false);
    const entryA = await journal(companyA, "A");
    const entryB = await journal(companyB, "B");
    const upload = (entryId: string) => callForm("/attachments", ownerToken, { entityType: "journal_entry", entityId: entryId });
    const kept = await upload(entryA.body.id); // مرفق قائم قبل الإنفاذ
    expect(kept.status, kept.text).toBe(201);
    vi.mocked(storage.uploadObject).mockClear();

    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: -30 });
    const refusedUpload = await upload(entryA.body.id);
    expect([refusedUpload.status, refusedUpload.code], refusedUpload.text).toEqual([403, "subscription_read_only"]);
    const refusedDelete = await call("DELETE", `/attachments/${kept.body.id}`, ownerToken);
    expect([refusedDelete.status, refusedDelete.code], refusedDelete.text).toEqual([403, "subscription_read_only"]);
    expect(storage.uploadObject).not.toHaveBeenCalled(); // لا ملف يتيم
    expect(storage.deleteObject).not.toHaveBeenCalled(); // لا ملف محذوف بلا رجعة
    expect(await prisma.attachment.count({ where: { entityId: entryA.body.id } })).toBe(1);
    expect(await prisma.attachment.count({ where: { id: kept.body.id } })).toBe(1);

    // الشركة الأخرى بلا صف مُنفَّذ: الرفع والحذف كما اليوم
    const okUpload = await upload(entryB.body.id);
    expect(okUpload.status, okUpload.text).toBe(201);
    expect(storage.uploadObject).toHaveBeenCalledTimes(1);
    expect((await call("DELETE", `/attachments/${okUpload.body.id}`, ownerToken)).status).toBe(204);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
  });

  // ── مراجعة #163 (2): نقل موظف إلى شركة "عمّال محطات فقط" يُفحَص على الوجهة ──────────────────────────────────────────
  it("checks an employee moved into a station-workers-only company against the destination: a station of that company is required", async () => {
    await globalSwitch(false);
    const stationA = await call("POST", "/cost-centers", ownerToken, { companyId: companyA, name: `محطة النقل ${stamp}` });
    const stationB = await call("POST", "/cost-centers", ownerToken, { companyId: companyB, name: `محطة ب ${stamp}` });
    expect([stationA.status, stationB.status]).toEqual([201, 201]);
    const fromB = async (extra: Record<string, unknown> = {}) => {
      const e = await call("POST", "/employees", ownerToken, { companyId: companyB, name: `موظف ب ${Math.random().toString(36).slice(2, 7)}`, hireDate: "2026-01-01", basicSalary: 2500, ...extra });
      expect(e.status, e.text).toBe(201);
      return e.body.id as string;
    };
    const office = await fromB();
    const workerB = await fromB({ assignedCostCenterId: stationB.body.id });

    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: 30, stationsAddon: "free" });
    const move = (id: string, extra: Record<string, unknown> = {}) => call("PATCH", `/employees/${id}`, ownerToken, { companyId: companyA, ...extra });
    // B → A بلا محطة: مرفوض
    const noStation = await move(office);
    expect([noStation.status, noStation.code], noStation.text).toEqual([403, "station_workers_only"]);
    // B → A بمحطة من B: مرفوض — يرفضه تحقق مسار الموظفين نفسه (المحطة من شركة أخرى، 400) قبل حارس الكتابة الذي يرفضه أيضاً
    for (const res of [await move(workerB), await move(office, { assignedCostCenterId: stationB.body.id })]) {
      expect([400, 403], res.text).toContain(res.status);
    }
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: workerB } })).companyId).toBe(companyB);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: office } })).companyId).toBe(companyB);
    // B → A بمحطة من A: مسموح
    const moved = await move(office, { assignedCostCenterId: stationA.body.id });
    expect(moved.status, moved.text).toBe(200);
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: office }, select: { companyId: true, assignedCostCenterId: true } })).toEqual({
      companyId: companyA, assignedCostCenterId: stationA.body.id,
    });
  });

  // ── مراجعة #164 (3): مسارات requireActionPermission تخضع لوحدة الباقة ───────────────────────────────────────────────
  it("gates leave requests by plan (enterprise) on the HR screen, owner included; allowed when entitled", async () => {
    await globalSwitch(false);
    const employee = await prisma.employee.create({ data: { tenantId, companyId: companyA, name: "موظف الإجازات", hireDate: new Date("2026-01-01"), basicSalary: 2000 } });
    const create = () => call("POST", "/leave-requests", ownerToken, { employeeId: employee.id, type: "annual", startDate: "2026-12-01", endDate: "2026-12-02" });
    const existing = await create();
    expect(existing.status, existing.text).toBe(201);

    await globalSwitch(true);
    for (const plan of ["basic", "professional"] as const) {
      await subscribeA({ plan, endDays: 30, stationsAddon: "free" }); // إضافة المحطات لا تفتح الإجازات
      const refused = await create();
      expect([refused.status, refused.code], `${plan}: ${refused.text}`).toEqual([403, "plan_module_not_included"]);
      expect(refused.body.details).toMatchObject({ moduleId: "leaveSettlements" });
      expect((await call("POST", `/leave-requests/${existing.body.id}/approve`, ownerToken)).code).toBe("plan_module_not_included");
    }
    expect((await call("GET", "/leave-requests", ownerToken)).status).toBe(200); // القراءة تمرّ (D31)
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: existing.body.id } })).status).not.toBe("approved");

    await subscribeA({ plan: "enterprise", endDays: 30 });
    expect((await create()).status).toBe(201);
    const approved = await call("POST", `/leave-requests/${existing.body.id}/approve`, ownerToken);
    expect(approved.status, approved.text).toBe(200);
  });

  it("gates station shift review and posting by the stations add-on; allowed when entitled", async () => {
    await globalSwitch(false);
    const station = await call("POST", "/cost-centers", ownerToken, { companyId: companyA, name: `محطة الورديات ${stamp}` });
    const worker = await prisma.employee.create({
      data: { tenantId, companyId: companyA, name: "عامل الوردية", hireDate: new Date("2026-01-01"), basicSalary: 2000, assignedCostCenterId: station.body.id },
    });
    const shift = (status: "submitted" | "approved", day: number) =>
      prisma.stationShift.create({ data: { tenantId, companyId: companyA, costCenterId: station.body.id, employeeId: worker.id, shiftDate: new Date(Date.UTC(2026, 8, day)), shiftType: "morning", status } });
    const submitted = await shift("submitted", 1);
    const approvedShift = await shift("approved", 2);
    const reject = () => call("POST", `/station-shifts/${submitted.id}/reject`, ownerToken, { reasonCode: "other", note: "اختبار" });
    const post = () => call("POST", `/station-shifts/${approvedShift.id}/post`, ownerToken);

    await globalSwitch(true);
    await subscribeA({ plan: "enterprise", endDays: 30, stationsAddon: "off" }); // أعلى باقة بلا إضافة المحطات
    for (const res of [await reject(), await post()]) {
      expect([res.status, res.code], res.text).toEqual([403, "plan_module_not_included"]);
      expect(res.body.details).toMatchObject({ moduleId: "stationShiftsReports" });
    }
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe("submitted");
    expect((await prisma.stationShift.findUniqueOrThrow({ where: { id: approvedShift.id } })).status).toBe("approved");
    expect((await call("GET", "/station-shifts/pending", ownerToken)).status).toBe(200); // القراءة تمرّ

    await subscribeA({ plan: "basic", endDays: 30, stationsAddon: "free" });
    const allowed = await reject();
    expect(allowed.status, allowed.text).toBe(200);
    // الترحيل يتجاوز الباقة؛ ما بعدها تحقق الوردية نفسها (وردية اختبار بلا قراءات)
    expect((await post()).code).not.toBe("plan_module_not_included");
  });

  it("gates employee-portal writes by the plan module of the employee's company; reads pass", async () => {
    await globalSwitch(false);
    const e = await prisma.employee.create({ data: { tenantId, companyId: companyA, name: "موظف بوابة الباقة", hireDate: new Date("2026-01-01"), basicSalary: 1000, portalActive: true } });
    const token = signEmployeePortalToken({ employeeId: e.id, tenantId });
    await globalSwitch(true);
    await subscribeA({ plan: "basic", endDays: 30, stationsAddon: "free" });
    const checkIn = await call("POST", "/attendance/check-in", token);
    expect([checkIn.status, checkIn.code], checkIn.text).toEqual([403, "plan_module_not_included"]);
    expect(checkIn.body.details).toMatchObject({ moduleId: "attendance" });
    expect((await call("POST", "/employee-portal/leave-requests", token, { type: "annual", startDate: "2026-11-10", endDate: "2026-11-11" })).code).toBe("plan_module_not_included");
    expect((await call("GET", "/employee-portal/leave-requests", token)).status).toBe(200);
    await subscribeA({ plan: "enterprise", endDays: 30 });
    expect((await call("POST", "/attendance/check-in", token)).status).toBe(201);
  });

  // ── مراجعة #163 (4): مقاعد نقطة البيع تحت قفل لكل شركة ────────────────────────────────────────────────────────────
  it("serializes POS seat changes per company: concurrent replacements never exceed capacity; a concurrent capacity cut and assignment cannot both win", async () => {
    await globalSwitch(false);
    const members = await prisma.user.findMany({ where: { tenantId, active: true, deletedAt: null, companyScope: { in: ["all", companyA] } }, select: { id: true }, take: 2 });
    expect(members.length).toBe(2);
    const [a, b] = members.map((m) => m.id);

    // السعة 1: استبدالان متزامنان بقائمتين مختلفتين — ينتهي الجدول بمقعد واحد (آخرهما)، لا بمقعدين
    await subscribeA({ plan: "basic", endDays: 30, posEnabled: true, posUsers: 0 });
    for (let round = 0; round < 5; round++) {
      await setCompanyPosUsers(companyA, []);
      await Promise.allSettled([setCompanyPosUsers(companyA, [a]), setCompanyPosUsers(companyA, [b])]);
      expect(await prisma.companyPosUser.count({ where: { companyId: companyA } }), `round ${round}`).toBe(1);
    }

    // السعة 2 تُخفَّض إلى 1 بالتزامن مع تعيين مقعدين: واحد فقط ينجح، والنتيجة ضمن السعة
    for (let round = 0; round < 5; round++) {
      await setCompanyPosUsers(companyA, []);
      await subscribeA({ plan: "basic", endDays: 30, posEnabled: true, posUsers: 1 });
      const results = await Promise.allSettled([
        setCompanyPosUsers(companyA, [a, b]),
        subscribeA({ plan: "basic", endDays: 30, posEnabled: true, posUsers: 0 }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled"), `round ${round}`).toHaveLength(1);
      const sub = await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: companyA } });
      expect(await prisma.companyPosUser.count({ where: { companyId: companyA } })).toBeLessThanOrEqual(1 + sub.posUsers);
    }
    await setCompanyPosUsers(companyA, []);
  });

  it("turning the global switch OFF again restores today's behaviour for the enforced company", async () => {
    await subscribeA({ plan: "basic", endDays: -30, posEnabled: false });
    await globalSwitch(false);
    expect((await journal(companyA, "A")).status).toBe(201);
    expect((await warehouse(companyA)).status).toBe(201);
  });
});
