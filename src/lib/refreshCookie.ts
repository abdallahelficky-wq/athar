import type { Request, Response } from "express";
import { env } from "../config/env";
import { expiresInToDate } from "./jwt";

/**
 * رمز التجديد (refresh token) في كوكي httpOnly بدل localStorage — لا يقرؤه أي JavaScript في الصفحة،
 * فثغرة XSS لا تستطيع سرقته وحمله خارج المتصفح.
 *
 * - Path=/api/auth: لا يُرسَل إلا لمسارات الجلسة (refresh/logout/switch)، لا مع كل طلب.
 * - SameSite=Lax + Secure: لا يُرسَل من موقع آخر في طلب POST (حماية CSRF)، وHTTPS فقط.
 * - Domain من REFRESH_COOKIE_DOMAIN (مثلاً `.atharerp.com`) حين تكون الواجهة والـAPI على نطاقين فرعيين
 *   لنفس الموقع (atharerp.com ← api.atharerp.com). بلا الضبط: كوكي للمضيف الحالي فقط.
 *
 * التوافق: الكوكي يُضبَط دائماً، لكن الرمز يُحذف من جسم الرد فقط حين يطلب العميل وضع الكوكي صراحةً
 * بالترويسة `X-Athar-Refresh-Mode: cookie` (الواجهة الجديدة حين VITE_REFRESH_COOKIE=true). العملاء
 * القدامى (نسخ PWA مخزَّنة، تطبيقات) يستمرون كما هم بالرمز في الجسم.
 */
export const REFRESH_COOKIE_NAME = "athar_rt";
const COOKIE_PATH = "/api/auth";

export function wantsCookieMode(req: Request): boolean {
  return String(req.headers["x-athar-refresh-mode"] || "").toLowerCase() === "cookie";
}

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === REFRESH_COOKIE_NAME) {
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      return value || undefined;
    }
  }
  return undefined;
}

function baseOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax" as const,
    path: COOKIE_PATH,
    ...(env.refreshCookieDomain ? { domain: env.refreshCookieDomain } : {}),
  };
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, { ...baseOptions(), expires: expiresInToDate(env.jwtRefreshExpiresIn) });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions());
}

/** رمز التجديد للطلب الحالي: من الجسم أولاً (العملاء القدامى)، وإلا من الكوكي. */
export function refreshTokenFrom(req: Request): string | undefined {
  const fromBody = typeof req.body?.refreshToken === "string" && req.body.refreshToken ? req.body.refreshToken : undefined;
  return fromBody ?? readRefreshCookie(req);
}

/**
 * يرسل رد جلسة (login/register/refresh/switch…): يضبط الكوكي لو في الرد refreshToken، ويحذفه من الجسم
 * في وضع الكوكي. ردود بلا refreshToken (شاشة اختيار الشركة chooseAccount) تمرّ كما هي.
 */
export function sendSession(req: Request, res: Response, result: unknown, status = 200): void {
  if (result && typeof result === "object" && typeof (result as { refreshToken?: unknown }).refreshToken === "string") {
    const { refreshToken, ...rest } = result as { refreshToken: string } & Record<string, unknown>;
    setRefreshCookie(res, refreshToken);
    res.status(status).json(wantsCookieMode(req) ? rest : result);
    return;
  }
  res.status(status).json(result);
}
