import { afterAll, afterEach, describe, expect, it } from "vitest";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";
import { register } from "../modules/auth/auth.service";
import { registerSchema } from "../modules/auth/auth.schemas";
import { applyStatusWebhook, sendWelcomeWhatsApp } from "./whatsapp";

/**
 * التسجيل يُخزّن جوال المالك موحّداً وموافقته (مسار registerSchema → register الحقيقي)، ولا يُعيده ضمن بيانات المستأجر؛
 * ورسالة الترحيب تُرسَل مرة واحدة فقط لكل مستأجر. رد Meta مصنوع يدوياً لأنه مدخل خارجي (CLAUDE.md §2).
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const saved = { ...env };
const tenantIds: string[] = [];
afterEach(() => Object.assign(env, saved));
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
});

function metaOk(id: string) {
  let count = 0;
  const impl = (async () => {
    count += 1;
    return new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, count: () => count };
}

async function registerWith(extra: Record<string, unknown>, tag: string) {
  const input = registerSchema.parse({ tenantName: `واتساب ${tag} ${stamp}`, businessActivity: "retail", name: "مالك", email: `wa-${tag}-${stamp}@example.com`, password: "Str0ng-Pass!", ...extra });
  const res = await register(input);
  tenantIds.push(res.tenant.id);
  return res;
}

describe("WhatsApp welcome on registration", () => {
  it("stores the normalized mobile and opt-in, and hides them from the public tenant", async () => {
    const res = await registerWith({ mobile: "057 307 6236", whatsappOptIn: true }, "store");
    expect(res.tenant).not.toHaveProperty("ownerMobile");
    expect(res.tenant).not.toHaveProperty("whatsappOptInAt");
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: res.tenant.id } });
    expect(t.ownerMobile).toBe("966573076236");
    expect(t.whatsappOptInAt).toBeInstanceOf(Date);
    // WhatsApp مطفأ في بيئة الاختبار: التسجيل لم يكتب أي سجل
    expect(await prisma.whatsAppMessageLog.count({ where: { tenantId: t.id } })).toBe(0);
  });

  it("rejects an invalid mobile at the schema", () => {
    expect(registerSchema.safeParse({ tenantName: "xx", businessActivity: "retail", name: "مالك", email: "a@example.com", password: "Str0ng-Pass!", mobile: "12345" }).success).toBe(false);
  });

  it("sends once per tenant and records Meta's message id", async () => {
    const res = await registerWith({ mobile: "0573076236", whatsappOptIn: true }, "send");
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: res.tenant.id } });
    Object.assign(env, { whatsappEnabled: true, whatsappPhoneNumberId: "PNID", whatsappAccessToken: "TOKEN" });
    const meta = metaOk(`wamid.${stamp}`);
    const args = { tenantId: t.id, phone: t.ownerMobile, optedIn: Boolean(t.whatsappOptInAt), ownerName: "مالك", companyName: t.name, plan: t.subscriptionPlan };
    expect(await sendWelcomeWhatsApp(args, meta.impl)).toBe("sent");
    expect(await sendWelcomeWhatsApp(args, meta.impl)).toBe("duplicate");
    expect(meta.count()).toBe(1);
    const log = await prisma.whatsAppMessageLog.findUniqueOrThrow({ where: { tenantId_kind: { tenantId: t.id, kind: "welcome" } } });
    expect(log).toMatchObject({ status: "sent", phone: "966573076236", providerMessageId: `wamid.${stamp}` });

    expect(await applyStatusWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: `wamid.${stamp}`, status: "delivered" }] } }] }] })).toBe(1);
    expect((await prisma.whatsAppMessageLog.findUniqueOrThrow({ where: { id: log.id } })).status).toBe("delivered");
  });

  it("does not send without opt-in", async () => {
    const res = await registerWith({ mobile: "0573076236", whatsappOptIn: false }, "noopt");
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: res.tenant.id } });
    expect(t.whatsappOptInAt).toBeNull();
    Object.assign(env, { whatsappEnabled: true, whatsappPhoneNumberId: "PNID", whatsappAccessToken: "TOKEN" });
    const meta = metaOk("unused");
    expect(await sendWelcomeWhatsApp({ tenantId: t.id, phone: t.ownerMobile, optedIn: Boolean(t.whatsappOptInAt), ownerName: "مالك", companyName: t.name, plan: t.subscriptionPlan }, meta.impl)).toBe("skipped");
    expect(meta.count()).toBe(0);
  });
});
