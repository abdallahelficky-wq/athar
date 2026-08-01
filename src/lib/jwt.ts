import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string; // userId
  tenantId: string;
  role: string;
  companyScope: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = { expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtAccessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
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
  return jwt.verify(token, env.jwtEmployeePortalSecret) as EmployeePortalTokenPayload;
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
