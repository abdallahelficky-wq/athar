import { createHmac, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { maskPhone } from "./phone";

/**
 * إرسال رسائل واتساب آلية عبر Meta WhatsApp Cloud API — رسالة الترحيب للمشترك الجديد حالياً.
 *
 * مطفأة افتراضياً: لا يحدث أي شيء (ولا يُكتَب سجل) إلا مع WHATSAPP_ENABLED=true وWHATSAPP_PHONE_NUMBER_ID
 * وWHATSAPP_ACCESS_TOKEN معاً. أول رسالة يبادر بها النظام لا تقبلها Meta إلا "قالباً" (template) معتمداً
 * مسبقاً، فالإرسال هنا دائماً قالب باسم WHATSAPP_WELCOME_TEMPLATE وبلغة WHATSAPP_TEMPLATE_LANG.
 *
 * لا يرمي أي خطأ للمستدعي أبداً — التسجيل لا يجب أن يفشل بسبب واتساب؛ النتيجة تُكتَب في
 * whatsapp_message_logs فقط.
 */

export type WhatsAppSendResult = { ok: true; messageId: string } | { ok: false; error: string };

export function whatsappConfigured(): boolean {
  return env.whatsappEnabled && Boolean(env.whatsappPhoneNumberId) && Boolean(env.whatsappAccessToken);
}

/** طلب HTTP واحد لإرسال قالب — منفصل حتى يُستبدل fetch في الاختبارات. */
export async function sendTemplateMessage(
  params: { to: string; template: string; lang: string; bodyParams: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppSendResult> {
  const url = `https://graph.facebook.com/${env.whatsappApiVersion}/${env.whatsappPhoneNumberId}/messages`;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.whatsappAccessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "template",
        template: {
          name: params.template,
          language: { code: params.lang },
          components: params.bodyParams.length
            ? [{ type: "body", parameters: params.bodyParams.map((text) => ({ type: "text", text: text.slice(0, 200) })) }]
            : [],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
    const messageId = body.messages?.[0]?.id;
    if (!res.ok || !messageId) {
      return { ok: false, error: `HTTP ${res.status}: ${body.error?.message ?? "no message id"}${body.error?.code ? ` (code ${body.error.code})` : ""}` };
    }
    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const PLAN_NAMES: Record<string, { ar: string; en: string }> = {
  basic: { ar: "الأساسية", en: "Basic" },
  professional: { ar: "الاحترافية", en: "Professional" },
  enterprise: { ar: "المؤسسات", en: "Enterprise" },
};

export function planDisplayName(plan: string, lang: string): string {
  const names = PLAN_NAMES[plan];
  if (!names) return plan;
  return lang.startsWith("en") ? names.en : names.ar;
}

/**
 * رسالة الترحيب لمستأجر جديد — مرة واحدة فقط لكل مستأجر: سجل "pending" يُنشأ أولاً بقيد فريد
 * (tenantId، kind)، فطلب ثانٍ (إعادة محاولة، تزامن) يصطدم بالقيد ويتوقف قبل أي إرسال.
 * الشروط: الإعداد مكتمل، ورقم موحّد صالح، وموافقة صاحب الاشتراك (whatsappOptIn).
 */
export async function sendWelcomeWhatsApp(
  input: { tenantId: string; phone: string | null | undefined; optedIn: boolean; ownerName: string; companyName: string; plan: string },
  fetchImpl: typeof fetch = fetch,
): Promise<"sent" | "failed" | "skipped" | "duplicate" | "disabled"> {
  if (!whatsappConfigured()) return "disabled";
  if (!input.phone || !input.optedIn) return "skipped";

  const template = env.whatsappWelcomeTemplate;
  let logId: string;
  try {
    const log = await prisma.whatsAppMessageLog.create({
      data: { tenantId: input.tenantId, kind: "welcome", phone: input.phone, template, status: "pending" },
    });
    logId = log.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    // eslint-disable-next-line no-console
    console.error("تعذّر إنشاء سجل رسالة واتساب الترحيبية:", err);
    return "failed";
  }

  const result = await sendTemplateMessage(
    { to: input.phone, template, lang: env.whatsappTemplateLang, bodyParams: [input.ownerName, input.companyName, planDisplayName(input.plan, env.whatsappTemplateLang)] },
    fetchImpl,
  );

  await prisma.whatsAppMessageLog
    .update({
      where: { id: logId },
      data: result.ok ? { status: "sent", providerMessageId: result.messageId } : { status: "failed", error: result.error.slice(0, 1000) },
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("تعذّر تحديث سجل رسالة واتساب:", err);
    });

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`فشل إرسال رسالة واتساب الترحيبية إلى ${maskPhone(input.phone)}: ${result.error}`);
    return "failed";
  }
  return "sent";
}

/**
 * تحقق توقيع Meta على جسم الـwebhook الخام (X-Hub-Signature-256 = "sha256=" + HMAC-SHA256 بسرّ التطبيق).
 * بلا WHATSAPP_APP_SECRET يُرفَض كل طلب (fail closed).
 */
export function verifyMetaSignature(raw: Buffer, header: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(raw).digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

type MetaWebhookBody = {
  entry?: { changes?: { value?: { statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[] } }[] }[];
};

const TRACKED_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/** يحدّث حالة الرسائل المسجّلة من إشعارات الحالة — رسائل غير موجودة في سجلّنا تُتجاهل. */
export async function applyStatusWebhook(body: MetaWebhookBody): Promise<number> {
  let updated = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const st of change.value?.statuses ?? []) {
        if (!st.id || !st.status || !TRACKED_STATUSES.has(st.status)) continue;
        const err = st.status === "failed" ? (st.errors?.map((e) => e.message ?? e.title).filter(Boolean).join("; ") || "failed") : undefined;
        const res = await prisma.whatsAppMessageLog.updateMany({
          where: { providerMessageId: st.id },
          data: { status: st.status, ...(err ? { error: err.slice(0, 1000) } : {}) },
        });
        updated += res.count;
      }
    }
  }
  return updated;
}
