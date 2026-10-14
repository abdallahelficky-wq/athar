import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CompanySubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { register } from "../auth/auth.service";
import {
  activateCompanySubscription,
  applyTimeTransitions,
  claimTimeTransition,
  reminderRecipients,
  runSubscriptionLifecycle,
  sendDueReminders,
  suspendCompanySubscription,
} from "./subscriptionLifecycle.service";

/**
 * دورة حياة الاشتراك (P3، docs/design/subscription-plans.md §6). المستأجرون والشركات والأعضاء من مسار التسجيل الحقيقي؛ صفوف
 * company_subscriptions تُكتَب يدوياً لأن كاتبها الحقيقي (P11/P5/P7) لم يُبنَ بعد — حالة مدخلة، لا مُخرَج يُفحَص شكله. الإرسال
 * يُستبدَل بجاسوس (البريد خدمة خارجية)، ونص الرسالة نفسه من buildSubscriptionReminderEmail الحقيقي.
 * كل تأكيد هنا لكل صف/شركة بعينها: ملفات اختبار أخرى قد تكتب صفوف اشتراك في القاعدة نفسها بالتوازي.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const DAY = 86_400_000;
const now = new Date();
let tenantId = "";
let ownerEmail = "";
const companies: Record<string, string> = {};
// جاسوس الإرسال في أول نبضة كاملة — تذكيرات بدء السماح والعرض فقط تُرسَل فيها نفسها بعد الانتقالات
const sendSpy = () => vi.fn(async (_to: string[], _subject: string, _body: string, _lang: string) => undefined);
const firstRunSend = sendSpy();

async function company(name: string) {
  const c = await prisma.company.create({ data: { tenantId, name: `${name} ${stamp}` } });
  companies[name] = c.id;
  return c.id;
}
async function sub(companyId: string, status: CompanySubscriptionStatus, endDays: number | null, extra: { grandfatheredNetPrice?: number } = {}) {
  const end = endDays == null ? null : new Date(now.getTime() + endDays * DAY);
  return prisma.companySubscription.create({
    data: {
      companyId,
      plan: "basic",
      billingPeriod: "yearly",
      status,
      currentPeriodStart: end ? new Date(end.getTime() - 365 * DAY) : null,
      currentPeriodEnd: end,
      legacyOpenEnded: end == null,
      netPrice: 500,
      ...extra,
    },
  });
}
const statusOf = async (name: string) => (await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: companies[name] } })).status;
const eventsOf = async (name: string) =>
  prisma.subscriptionEvent.findMany({ where: { companySubscription: { companyId: companies[name] } }, orderBy: { at: "asc" } });

describe("subscription lifecycle (P3)", () => {
  beforeAll(async () => {
    ownerEmail = `life-owner-${stamp}@example.com`;
    const r = await register({ tenantName: `دورة الحياة ${stamp}`, businessActivity: "retail", name: "المالك", email: ownerEmail, password: "Str0ng-Pass!" });
    tenantId = r.tenant.id;
    companies.untouched = (await prisma.company.findFirstOrThrow({ where: { tenantId } })).id;

    await sub(await company("activeEnded"), "active", -2, { grandfatheredNetPrice: 300 });
    await sub(await company("activeLongEnded"), "active", -10);
    await sub(await company("graceEnded"), "grace", -8);
    await sub(await company("trialEnded"), "trialing", -1);
    await sub(await company("activeFuture"), "active", 30);
    await sub(await company("legacy"), "active", null);
    await sub(await company("awaiting"), "awaiting_payment", -5);
  }, 120_000);

  it("changes nothing for a company without a subscription row: the tenant's own status stays as it is today", async () => {
    const before = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { subscriptionStatus: true, trialEndsAt: true } });
    await runSubscriptionLifecycle(now, firstRunSend);
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { subscriptionStatus: true, trialEndsAt: true } })).toEqual(before);
    expect(await prisma.companySubscription.count({ where: { companyId: companies.untouched } })).toBe(0);
  });

  it("moves rows to the status their dates call for, once, with an event; a paid term ending clears the grandfathered price", async () => {
    await applyTimeTransitions(now);
    expect(await statusOf("activeEnded")).toBe("grace");
    expect(await statusOf("activeLongEnded")).toBe("expired"); // فاتته فترة السماح كلها
    expect(await statusOf("graceEnded")).toBe("expired");
    expect(await statusOf("trialEnded")).toBe("expired"); // بلا سماح
    for (const name of ["activeFuture", "legacy", "awaiting"]) expect(await statusOf(name), name).toBe(name === "awaiting" ? "awaiting_payment" : "active");

    const ended = await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: companies.activeEnded } });
    expect(ended.grandfatheredNetPrice).toBeNull();
    const [event] = await eventsOf("activeEnded");
    expect(event).toMatchObject({ type: "grace_started", actor: "system_job", before: { status: "active", grandfatheredNetPrice: "300.00" } });
    expect((await eventsOf("trialEnded")).map((e) => [e.type, (e.before as { status: string }).status])).toEqual([["expired", "trialing"]]);

    // نبضة ثانية: لا انتقال ولا حدث جديد
    await applyTimeTransitions(now);
    for (const name of ["activeEnded", "activeLongEnded", "graceEnded", "trialEnded"]) expect(await eventsOf(name), name).toHaveLength(1);
  });

  it("applies a transition exactly once when two server instances act on the same snapshot", async () => {
    const created = await sub(await company("parallel"), "active", -1);
    // لقطة واحدة قرأتها نسختان من الخادم قبل أن تكتب أيّهما
    const snapshot = { id: created.id, status: created.status, grandfatheredNetPrice: created.grandfatheredNetPrice };
    const results = await Promise.all([claimTimeTransition(snapshot, "grace", now), claimTimeTransition(snapshot, "grace", now)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    // ولقطة قديمة بعد أن سبقتها نسخة أخرى: لا تحديث ولا حدث
    expect(await claimTimeTransition(snapshot, "expired", now)).toBe(false);
    expect(await statusOf("parallel")).toBe("grace");
    expect(await eventsOf("parallel")).toHaveLength(1);
  });

  it("sends reminders to the owner and the company's admins only, once per window, and retries after a failed send", async () => {
    const target = await company("reminded");
    await sub(target, "active", 10);
    // مدير بنطاق الشركة، محاسب (لا يُراسَل)، مدير مقيَّد بشركة أخرى، مدير معطَّل، ومدير في مستأجر آخر بشركة بالاسم نفسه
    const member = async (tag: string, data: Record<string, unknown>, tid = tenantId) => {
      const identity = await prisma.identity.create({ data: { email: `life-${tag}-${stamp}@example.com` } });
      await prisma.user.create({ data: { tenantId: tid, identityId: identity.id, name: tag, inviteStatus: "accepted", ...data } as never });
    };
    await member("admin", { role: "admin", companyScope: target });
    await member("accountant", { role: "accountant", companyScope: "all" });
    await member("otheradmin", { role: "admin", companyScope: companies.activeFuture });
    await member("inactive", { role: "admin", companyScope: "all", active: false });
    const other = await register({ tenantName: `دورة الحياة ${stamp}`, businessActivity: "retail", name: "مالك آخر", email: `life-other-${stamp}@example.com`, password: "Str0ng-Pass!" });
    await member("foreign", { role: "admin", companyScope: "all" }, other.tenant.id);

    expect(await reminderRecipients(target)).toEqual([`life-admin-${stamp}@example.com`, ownerEmail].sort());

    const failing = vi.fn(async (_to: string[], _subject: string, _body: string, _lang: string): Promise<undefined> => {
      throw new Error("Resend down");
    });
    const first = await sendDueReminders(now, failing);
    expect(failing.mock.calls.filter((c) => (c[1] as string).includes(`reminded ${stamp}`))).toHaveLength(1);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    const subRow = await prisma.companySubscription.findUniqueOrThrow({ where: { companyId: target } });
    expect(await prisma.subscriptionReminder.count({ where: { companySubscriptionId: subRow.id } })).toBe(0); // الحجز أُلغي

    const send = sendSpy();
    await Promise.all([sendDueReminders(now, send), sendDueReminders(now, send)]);
    await sendDueReminders(now, send);
    const mine = send.mock.calls.filter((c) => (c[1] as string).includes(`reminded ${stamp}`));
    expect(mine).toHaveLength(1);
    expect(mine[0][1]).toBe(`reminded ${stamp}: ينتهي الاشتراك بعد 14 يوماً`);
    expect(mine[0][0]).toEqual([`life-admin-${stamp}@example.com`, ownerEmail].sort());
    expect(await prisma.subscriptionReminder.findMany({ where: { companySubscriptionId: subRow.id }, select: { kind: true } })).toEqual([{ kind: "before_14" }]);
  });

  it("sends the grace-start and read-only reminders in the same tick that moved the rows, with the right wording", async () => {
    const send = firstRunSend;
    const subjectFor = (name: string) => send.mock.calls.find((c) => (c[1] as string).startsWith(`${name} ${stamp}:`))?.[1];
    expect(subjectFor("activeEnded")).toMatch(/انتهى الاشتراك — عرض فقط من /);
    expect(subjectFor("trialEnded")).toBe(`trialEnded ${stamp}: الشركة الآن في وضع العرض فقط`);
    expect(send.mock.calls.find((c) => (c[1] as string).startsWith(`trialEnded ${stamp}:`))?.[2]).toContain("انتهت الفترة التجريبية");
    // انتهت قبل 10 أيام ومرّت 3 أيام على بدء العرض فقط (سماح 7 أيام) — تذكير العرض فقط؛ وصف قديم بلا نهاية لا تذكير له
    expect(subjectFor("activeLongEnded")).toBe(`activeLongEnded ${stamp}: الشركة الآن في وضع العرض فقط`);
    expect(subjectFor("legacy")).toBeUndefined();
  });

  it("suspends and reactivates to the by-date status of the pre-suspension status, never open-ended active", async () => {
    const cases: [string, CompanySubscriptionStatus, number, CompanySubscriptionStatus][] = [
      ["suspActive", "active", 40, "active"],
      ["suspGrace", "active", -3, "grace"],
      ["suspTrial", "trialing", -1, "expired"],
      ["suspTrialFuture", "trialing", 5, "trialing"],
    ];
    for (const [name, status, endDays, expected] of cases) {
      await sub(await company(name), status, endDays);
      const suspended = await suspendCompanySubscription(companies[name], "مراجعة إدارية", "platform_admin:test", now);
      expect([suspended.status, suspended.suspensionReason]).toEqual(["suspended", "مراجعة إدارية"]);
      // بعد التعليق بجزء من الثانية: حدثان بالطابع الزمني نفسه لا ترتيب مضموناً بينهما عند القراءة بـat
      const activated = await activateCompanySubscription(companies[name], "platform_admin:test", new Date(now.getTime() + 1));
      expect([name, activated.status, activated.suspensionReason]).toEqual([name, expected, null]);
      expect((await eventsOf(name)).map((e) => e.type)).toEqual(["suspended", "activated"]);
    }
    await expect(activateCompanySubscription(companies.suspActive, "platform_admin:test", now)).rejects.toThrow("الاشتراك ليس معلّقاً");
    await suspendCompanySubscription(companies.suspActive, "x", "platform_admin:test", now);
    await expect(suspendCompanySubscription(companies.suspActive, "x", "platform_admin:test", now)).rejects.toThrow("الاشتراك معلّق بالفعل");
    await expect(activateCompanySubscription(companies.untouched, "platform_admin:test", now)).rejects.toThrow("لا يوجد اشتراك لهذه الشركة");
  });
});
