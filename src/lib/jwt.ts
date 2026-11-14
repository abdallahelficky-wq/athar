import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string; // userId
  tenantId: string;
  role: string;
  companyScope: string;
  // true لو كانت شركة *هذه العضوية تحديداً* في وضع "عرض فقط" (اشتراك/فترة تجريبية منتهية) لحظة
  // إصدار هذا الرمز — يُحسَب من حالة Tenant الخاصة بـ user.tenantId فقط، لا من الهوية (Identity)
  // المشتركة، فلا يتسرّب بين عضويتين مختلفتين لنفس الشخص (راجع auth.service.ts: isTenantReadOnly).
  // يُعاد حسابه من جديد عند كل تجديد رمز (refresh)، فتفعيل الاشتراك ينعكس تلقائياً خلال 15 دقيقة
  // كحد أقصى بلا حاجة لتسجيل خروج/دخول.
  readOnly: boolean;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = { expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtAccessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export interface IdentityChoiceTokenPayload {
  identityId: string;
}

/**
 * رمز قصير الأجل (5 دقائق) يُصدَر بعد التحقق من كلمة مرور هوية (Identity) لها أكثر من عضوية
 * (شركة/مستأجر) واحدة، لإتمام اختيار العضوية المطلوب تسجيل الدخول إليها فعلياً (الخطوة الثانية).
 * موقّع بسرّ مُشتَق من سرّ رموز الدخول لكن مختلف عنه تماماً (نفس مبدأ فصل سرّ بوابة الموظف) —
 * لا يمكن لهذا الرمز أبداً أن يُقبَل عبر verifyAccessToken أو العكس، ولا يحمل tenantId/role/
 * companyScope إطلاقاً فلا يصلح كرمز دخول حقيقي حتى لو حاول أحد إساءة استخدامه.
 */
function identityChoiceSecret(): string {
  return `${env.jwtAccessSecret}::identity-choice`;
}

export function signIdentityChoiceToken(payload: IdentityChoiceTokenPayload): string {
  return jwt.sign(payload, identityChoiceSecret(), { expiresIn: "5m" });
}

export function verifyIdentityChoiceToken(token: string): IdentityChoiceTokenPayload {
  return jwt.verify(token, identityChoiceSecret()) as IdentityChoiceTokenPayload;
}

export interface EmployeePortalTokenPayload {
  employeeId: string;
  tenantId: string;
}

/** موقّع بسرّ منفصل تماماً عن رموز User الإدارية — لا يمكن التحقق من هذا الرمز عبر verifyAccessToken أو العكس */
export function signEmployeePortalToken(payload: EmployeePortalTokenPayload): string {
  const options: jwt.SignOptions = { expiresIn: env.jwtEmployeePortalExpiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtEmployeePortalSecret, options);
}

export function verifyEmployeePortalToken(token: string): EmployeePortalTokenPayload {
  const payload = jwt.verify(token, env.jwtEmployeePortalSecret) as EmployeePortalTokenPayload & { kind?: string };
  // رمز مستخدم المحطات (بنفس السرّ) ليس رمز موظف — لا يفتح بوابة الموظف (حضور، إجازات...)
  if (payload.kind === "station" || !payload.employeeId) throw new Error("not an employee portal token");
  return payload;
}

/** رمز تطبيق المحطات لمستخدم محطات (StationUser) — نفس سرّ بوابة الموظف ومدتها، ويحمل kind يميّزه عن رمز الموظف */
export interface StationUserTokenPayload {
  stationUserId: string;
  tenantId: string;
  kind: "station";
}

export function signStationUserToken(payload: Omit<StationUserTokenPayload, "kind">): string {
  const options: jwt.SignOptions = { expiresIn: env.jwtEmployeePortalExpiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign({ ...payload, kind: "station" }, env.jwtEmployeePortalSecret, options);
}

export function verifyStationUserToken(token: string): StationUserTokenPayload {
  const payload = jwt.verify(token, env.jwtEmployeePortalSecret) as StationUserTokenPayload;
  if (payload.kind !== "station" || !payload.stationUserId) throw new Error("not a station user token");
  return payload;
}

/** نوع رمز الجوال دون التحقق من صلاحيته (للتوجيه فقط؛ التحقق في الوسيط المختص) */
export function portalTokenKind(token: string): "station" | "employee" {
  const decoded = jwt.decode(token) as { kind?: string } | null;
  return decoded?.kind === "station" ? "station" : "employee";
}

export interface RefreshTokenPayload {
  sub: string; // userId
  jti: string; // معرّف فريد للرمز، يُستخدم لمطابقته بالنسخة المخزّنة (مجزّأة) في قاعدة البيانات
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: jwt.SignOptions = { expiresIn: env.jwtRefreshExpiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtRefreshSecret, options);
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenPayload;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** يحوّل مدة مثل "30d" أو "15m" إلى تاريخ انتهاء فعلي */
export function expiresInToDate(expiresIn: string): Date {
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  if (!match) return new Date(Date.now() + 15 * 60 * 1000);
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 60_000;
  return new Date(Date.now() + value * multiplier);
}
