import express, { Router } from "express";
import { handlePtsUpload } from "./ptsReceiver.service";

/**
 * نقطة استقبال أجهزة PTS-2 — بلا جلسة مستخدم: المصادقة بتوقيع HMAC لكل متحكم داخل handlePtsUpload. تُركَّب في app.ts قبل
 * express.json لأن التوقيع يُحسَب على الجسم الخام بالبايت كما وصل (أي إعادة تسلسل لـJSON تغيّر البايتات وتُفشل التحقق).
 * الجهاز يرسل application/json؛ يُقبَل أي نوع محتوى لأن بعض نسخ البرنامج تضيف charset أو ترسله بلا ترويسة.
 */
export const ptsDeviceRoutes = Router();

ptsDeviceRoutes.post("/upload", express.raw({ type: () => true, limit: "256kb" }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const result = await handlePtsUpload(raw, req.headers);
  res.status(result.status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(result.body.length));
  if (result.signature) res.setHeader("X-Data-Signature", result.signature);
  res.end(result.body);
});
