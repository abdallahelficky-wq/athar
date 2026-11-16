import { RequestHandler } from "express";
import { tooManyRequests } from "./httpError";

export const PUBLIC_RATE_LIMITED_MESSAGE = "طلبات كثيرة من هذا الجهاز، حاول مرة أخرى بعد قليل";

/**
 * حدّ طلبات بسيط لكل IP لمسارات عامة بلا مصادقة (المتجر الإلكتروني) — نافذة ثابتة في الذاكرة. يكفي لخدمة
 * تعمل بنسخة واحدة: الغرض منع كشط الكتالوج واستنزاف القاعدة، لا حماية دخول (تلك لها loginThrottle في القاعدة).
 * req.ip يعتمد على trust proxy المضبوط في app.ts، فلكل عميل عدّاده لا عدّاد الوكيل.
 */
export function publicRateLimit(options: { windowMs: number; max: number; now?: () => number }): RequestHandler {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();
  return (req, _res, next) => {
    const t = now();
    // كنس دوري حتى لا تكبر الخريطة بعناوين لم تعد تطلب
    if (t - lastSweep > options.windowMs) {
      for (const [ip, entry] of hits) if (entry.resetAt <= t) hits.delete(ip);
      lastSweep = t;
    }
    const key = req.ip || "unknown";
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      hits.set(key, { count: 1, resetAt: t + options.windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > options.max) throw tooManyRequests(PUBLIC_RATE_LIMITED_MESSAGE);
    next();
  };
}
