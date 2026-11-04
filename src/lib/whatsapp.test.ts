import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";

// هذه الدوال لا تلمس قاعدة البيانات؛ الوحدة تستورد prisma فقط لدوال السجل (مُختبَرة في whatsappWelcome.integration.test.ts).
vi.mock("./prisma", () => ({ prisma: {} }));
import { planDisplayName, sendTemplateMessage, verifyMetaSignature } from "./whatsapp";

/**
 * الطلب المُرسَل لـMeta يُؤخذ من sendTemplateMessage نفسها (fetch بديل يلتقطه)؛ ردود Meta مصنوعة يدوياً لأنها
 * ما يصل من الخارج فعلاً (CLAUDE.md §2).
 */
const saved = { ...env };
afterEach(() => Object.assign(env, saved));

function capture(response: { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("sendTemplateMessage", () => {
  it("posts a template message to the configured phone number id", async () => {
    Object.assign(env, { whatsappPhoneNumberId: "PNID", whatsappAccessToken: "TOKEN", whatsappApiVersion: "v23.0" });
    const { calls, impl } = capture({ status: 200, body: { messages: [{ id: "wamid.1" }] } });
    const res = await sendTemplateMessage({ to: "966573076236", template: "athar_welcome", lang: "ar", bodyParams: ["عبدالله", "شركة س", "الأساسية"] }, impl);
    expect(res).toEqual({ ok: true, messageId: "wamid.1" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v23.0/PNID/messages");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "966573076236", type: "template", template: { name: "athar_welcome", language: { code: "ar" } } });
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["عبدالله", "شركة س", "الأساسية"]);
  });

  it("returns Meta's error without throwing", async () => {
    const { impl } = capture({ status: 400, body: { error: { message: "Template name does not exist", code: 132001 } } });
    const res = await sendTemplateMessage({ to: "966573076236", template: "x", lang: "ar", bodyParams: [] }, impl);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("132001");
  });

  it("returns network errors without throwing", async () => {
    const impl = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    const res = await sendTemplateMessage({ to: "966573076236", template: "x", lang: "ar", bodyParams: [] }, impl);
    expect(res).toEqual({ ok: false, error: "ECONNRESET" });
  });
});

describe("verifyMetaSignature", () => {
  const raw = Buffer.from('{"entry":[]}');
  const sig = "sha256=" + createHmac("sha256", "secret").update(raw).digest("hex");
  it("accepts a valid signature", () => expect(verifyMetaSignature(raw, sig, "secret")).toBe(true));
  it("rejects a wrong secret", () => expect(verifyMetaSignature(raw, sig, "other")).toBe(false));
  it("rejects a tampered body", () => expect(verifyMetaSignature(Buffer.from('{"entry":[1]}'), sig, "secret")).toBe(false));
  it("fails closed without a secret or header", () => {
    expect(verifyMetaSignature(raw, sig, undefined)).toBe(false);
    expect(verifyMetaSignature(raw, undefined, "secret")).toBe(false);
  });
});

describe("planDisplayName", () => {
  it("maps plan ids to the names shown on the pricing page", () => {
    expect(planDisplayName("professional", "ar")).toBe("الاحترافية");
    expect(planDisplayName("enterprise", "en")).toBe("Enterprise");
    expect(planDisplayName("unknown", "ar")).toBe("unknown");
  });
});
