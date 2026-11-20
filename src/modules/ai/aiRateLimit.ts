import type { RequestHandler } from "express";
import { HttpError } from "../../lib/httpError";

/**
 * حدّ استخدام لنقاط النموذج اللغوي المدفوعة: نافذة منزلقة لكل (مستأجر، مستخدم). في الذاكرة لكل نسخة خادم —
 * يكفي كحارس تكلفة ضد حلقة عميل أو نقر متكرر، وليس حداً أمنياً صارماً عبر النسخ.
 */
export function aiRateLimit(max = 30, windowMs = 60 * 60 * 1000): RequestHandler {
  const hits = new Map<string, number[]>();
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next();
    const key = `${auth.tenantId}:${auth.sub}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return next(new HttpError(429, "Athar AI usage limit reached, try again later"));
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
}
