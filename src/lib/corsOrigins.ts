import { env } from "../config/env";

/**
 * هل يُسمح لهذا الأصل (Origin) باستدعاء الـAPI من المتصفح؟
 * - بلا Origin: طلب ليس من صفحة متصفح عابرة للأصول (تطبيق أصلي، جهاز، خادم) — CORS لا ينطبق، نسمح.
 * - نطاقات أثر في env.corsAllowedOrigins (atharerp.com وwww وRailway، وأي إضافة عبر CORS_ALLOWED_ORIGINS).
 * - خارج الإنتاج: localhost/127.0.0.1 بأي منفذ لتطوير الواجهة محلياً وفي Codespaces.
 */
export function isAllowedCorsOrigin(origin: string | undefined, nodeEnv = env.nodeEnv, allowed = env.corsAllowedOrigins): boolean {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, "");
  if (allowed.includes(normalized)) return true;
  if (nodeEnv !== "production") {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) return true;
    if (/^https:\/\/[a-z0-9-]+\.app\.github\.dev$/.test(normalized)) return true;
  }
  return false;
}
