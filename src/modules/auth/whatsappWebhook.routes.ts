import express, { Router } from "express";
import { env } from "../../config/env";
import { applyStatusWebhook, verifyMetaSignature } from "../../lib/whatsapp";

/**
 * Webhook حالات رسائل واتساب من Meta (تسليم/قراءة/فشل) — بلا جلسة مستخدم: GET للتحقق عند الربط بـ
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN، وPOST موقَّع بسرّ التطبيق (WHATSAPP_APP_SECRET) على الجسم الخام، لذا
 * يُركَّب في app.ts قبل express.json. لا يقرأ ولا يكتب إلا whatsapp_message_logs بمعرّف رسالة Meta.
 */
export const whatsappWebhookRoutes = Router();

whatsappWebhookRoutes.get("/", (req, res) => {
  const token = env.whatsappWebhookVerifyToken;
  if (token && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === token) {
    res.status(200).type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
    return;
  }
  res.sendStatus(403);
});

whatsappWebhookRoutes.post("/", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!verifyMetaSignature(raw, req.header("x-hub-signature-256"), env.whatsappAppSecret)) {
    res.sendStatus(401);
    return;
  }
  try {
    await applyStatusWebhook(JSON.parse(raw.toString("utf8")));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("تعذّر معالجة webhook واتساب:", err);
  }
  // 200 دائماً بعد توقيع صحيح — وإلا تعيد Meta الإرسال مراراً لخطأ لن يُحلّ بالإعادة.
  res.sendStatus(200);
});
