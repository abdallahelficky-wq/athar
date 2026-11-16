import { createHash, randomInt, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { badRequest, serviceUnavailable, tooManyRequests, unauthorized } from "../../lib/httpError";
import { normalizeMobile, maskPhone } from "../../lib/phone";
import { sendTemplateMessage, whatsappConfigured } from "../../lib/whatsapp";
import type { StoreContext } from "./store.service";

/**
 * دخول عملاء المتجر الإلكتروني برمز لمرة واحدة (OTP) على الجوال عبر واتساب. عميل المتجر ليس مستخدماً في أثر:
 *  - حسابه خاص بمتجر شركة واحدة (companyId + phone)، ورمزه موقَّع بسرّ منفصل عن رموز المستخدمين وبوابة الموظف،
 *    فلا يُقبَل رمز عميل متجر على أي مسار آخر، ولا رمز متجر شركة على متجر شركة أخرى.
 *  - الرمز لا يُخزَّن، تُخزَّن تجزئته مع عمر قصير وحدّ محاولات؛ وطلب الرمز محدود لكل جوال ولكل IP.
 *  - لا يُكشف هل للجوال حساب: الطلب والتحقق يتصرفان بالطريقة نفسها لجوال جديد وقديم (الحساب يُنشأ عند أول تحقق ناجح).
 */
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_MS = 60_000;
export const OTP_MAX_PER_PHONE_PER_HOUR = 5;
export const OTP_MAX_PER_IP_PER_HOUR = 20;
const TOKEN_EXPIRES_IN = "30d";

export const INVALID_PHONE = "رقم الجوال غير صحيح";
export const OTP_LOGIN_DISABLED = "الدخول بالجوال غير مفعّل في هذا المتجر بعد";
export const OTP_WAIT = "انتظر دقيقة قبل طلب رمز جديد";
export const OTP_TOO_MANY = "طلبات رموز كثيرة، حاول مرة أخرى لاحقاً";
export const OTP_SEND_FAILED = "تعذّر إرسال الرمز الآن، حاول مرة أخرى بعد قليل";
export const OTP_INVALID = "الرمز غير صحيح أو انتهت صلاحيته";
export const STORE_LOGIN_REQUIRED = "سجّل الدخول أولاً";

/** قناة إرسال الرمز — كائن قابل للاستبدال في الاختبارات فقط (رد Meta مدخل خارجي؛ بقية المسار حقيقي). */
export const otpDelivery = {
  enabled: (): boolean => whatsappConfigured() && Boolean(env.storeOtpWhatsappTemplate),
  send: async (to: string, code: string): Promise<{ ok: boolean; error?: string }> =>
    sendTemplateMessage({ to, template: env.storeOtpWhatsappTemplate, lang: env.whatsappTemplateLang, bodyParams: [code], otpButtonCode: code }),
};

const tokenSecret = () => `${env.jwtAccessSecret}::store-customer`;
const hashCode = (companyId: string, phone: string, code: string) => createHash("sha256").update(`${companyId}:${phone}:${code}:${env.jwtAccessSecret}`).digest("hex");

export function storePhone(store: StoreContext, input: unknown): string {
  const phone = normalizeMobile(input, store.country);
  if (!phone) throw badRequest(INVALID_PHONE);
  return phone;
}

export async function requestOtp(store: StoreContext, rawPhone: unknown, ip: string) {
  if (!otpDelivery.enabled()) throw serviceUnavailable(OTP_LOGIN_DISABLED);
  const phone = storePhone(store, rawPhone);
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60_000);
  const [last, phoneCount, ipCount] = await Promise.all([
    prisma.storeOtp.findFirst({ where: { companyId: store.companyId, phone }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.storeOtp.count({ where: { companyId: store.companyId, phone, createdAt: { gt: hourAgo } } }),
    prisma.storeOtp.count({ where: { ip, createdAt: { gt: hourAgo } } }),
  ]);
  if (last && now - last.createdAt.getTime() < OTP_RESEND_AFTER_MS) throw tooManyRequests(OTP_WAIT);
  if (phoneCount >= OTP_MAX_PER_PHONE_PER_HOUR || ipCount >= OTP_MAX_PER_IP_PER_HOUR) throw tooManyRequests(OTP_TOO_MANY);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // يُسجَّل الطلب قبل الإرسال: محاولة فاشلة الإرسال تُحسَب في الحدّ أيضاً، فلا يُستنزَف مزوّد الرسائل بإعادة المحاولة
  const otp = await prisma.storeOtp.create({
    data: { tenantId: store.tenantId, companyId: store.companyId, phone, codeHash: hashCode(store.companyId, phone, code), expiresAt: new Date(now + OTP_TTL_MS), ip },
    select: { id: true },
  });
  const sent = await otpDelivery.send(phone, code);
  if (!sent.ok) {
    console.error(`[storeOtp] تعذّر إرسال رمز دخول المتجر إلى ${maskPhone(phone)} (شركة ${store.companyId}): ${sent.error ?? ""}`);
    // رمز لم يصل لا يبقى صالحاً
    await prisma.storeOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    throw serviceUnavailable(OTP_SEND_FAILED);
  }
  return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 };
}

export async function verifyOtp(store: StoreContext, rawPhone: unknown, rawCode: unknown) {
  const phone = storePhone(store, rawPhone);
  const code = String(rawCode ?? "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
  const otp = await prisma.storeOtp.findFirst({
    where: { companyId: store.companyId, phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw unauthorized(OTP_INVALID);
  // المحاولة تُحسَب قبل المقارنة وبشرط العدّاد، فطلبان متزامنان لا يتجاوزان الحدّ
  const counted = await prisma.storeOtp.updateMany({ where: { id: otp.id, attempts: { lt: OTP_MAX_ATTEMPTS }, consumedAt: null }, data: { attempts: { increment: 1 } } });
  if (counted.count !== 1) throw unauthorized(OTP_INVALID);
  const expected = Buffer.from(otp.codeHash, "hex");
  const given = Buffer.from(hashCode(store.companyId, phone, code), "hex");
  if (code.length !== 6 || expected.length !== given.length || !timingSafeEqual(expected, given)) throw unauthorized(OTP_INVALID);
  const consumed = await prisma.storeOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw unauthorized(OTP_INVALID);

  const customer = await prisma.storeCustomer.upsert({
    where: { companyId_phone: { companyId: store.companyId, phone } },
    create: { tenantId: store.tenantId, companyId: store.companyId, phone, lastLoginAt: new Date() },
    update: { lastLoginAt: new Date() },
  });
  return { token: signStoreCustomerToken(customer.id, store.companyId), customer: publicCustomer(customer) };
}

export function signStoreCustomerToken(customerId: string, companyId: string): string {
  return jwt.sign({ kind: "store_customer", sub: customerId, companyId }, tokenSecret(), { expiresIn: TOKEN_EXPIRES_IN });
}

export const publicCustomer = (c: { phone: string; name: string | null; city: string | null }) => ({ phone: c.phone, name: c.name, city: c.city });

/** عميل المتجر من ترويسة Authorization — null إن لم يُرسَل رمز؛ رمز غير صالح أو لمتجر آخر أو لحساب محذوف = 401. */
export async function customerFromAuthHeader(store: StoreContext, header: string | undefined) {
  if (!header) return null;
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let payload: { kind?: string; sub?: string; companyId?: string };
  try {
    payload = jwt.verify(token, tokenSecret()) as typeof payload;
  } catch {
    throw unauthorized(STORE_LOGIN_REQUIRED);
  }
  if (payload.kind !== "store_customer" || !payload.sub || payload.companyId !== store.companyId) throw unauthorized(STORE_LOGIN_REQUIRED);
  const customer = await prisma.storeCustomer.findFirst({ where: { id: payload.sub, companyId: store.companyId, tenantId: store.tenantId } });
  if (!customer) throw unauthorized(STORE_LOGIN_REQUIRED);
  return customer;
}

export async function requireCustomer(store: StoreContext, header: string | undefined) {
  const customer = await customerFromAuthHeader(store, header);
  if (!customer) throw unauthorized(STORE_LOGIN_REQUIRED);
  return customer;
}

const clean = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function updateCustomerProfile(store: StoreContext, customerId: string, body: { name?: unknown; city?: unknown }) {
  const customer = await prisma.storeCustomer.update({
    where: { id: customerId },
    data: { ...("name" in body ? { name: clean(body.name, 80) } : {}), ...("city" in body ? { city: clean(body.city, 60) } : {}) },
  });
  return publicCustomer(customer);
}
