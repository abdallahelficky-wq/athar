import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword } from "../../lib/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateInviteToken,
  expiresInToDate,
} from "../../lib/jwt";
import { env } from "../../config/env";
import { createChartFromTemplate } from "../../lib/defaultChartOfAccounts";
import { CHART_TEMPLATE_BY_ACTIVITY, BusinessActivity } from "../../lib/chartTemplates";
import { createStarterItems, createCashParties, createDefaultWarehouse } from "../../lib/starterData";
import { sendInviteEmail, sendPasswordResetEmail, sendWelcomeEmail } from "../../lib/mailer";
import { badRequest, conflict, notFound, unauthorized } from "../../lib/httpError";
import type { Lang } from "../../lib/i18n/translate";
import type { Tenant, User } from "@prisma/client";

const TRIAL_DAYS = 30;
const INVITE_EXPIRES_DAYS = 7;
const PASSWORD_RESET_EXPIRES_MINUTES = 30;
const PASSWORD_RESET_MAX_PER_HOUR = 3;
// رسالة عامة ثابتة تُعرَض دائماً بغضّ النظر عن وجود البريد فعلياً من عدمه أو تجاوز حد الطلبات،
// حتى لا يُستخدَم مسار استعادة كلمة المرور لاكتشاف أي بريد إلكتروني مسجَّل بالنظام.
const FORGOT_PASSWORD_MESSAGE = "لو هذا البريد الإلكتروني مسجّل بالنظام، سيصلك رابط لإعادة تعيين كلمة المرور خلال دقائق.";

// الحساب الرئيسي/المالك الوحيد المخوَّل تلقائياً بدور "مدير عام" (super_admin) عند التسجيل —
// هذا الدور غير قابل للمنح عبر الدعوة العادية (inviteSchema)، وهو الوحيد المسموح له بتنفيذ
// "تثبيت الشجرة القياسية".
const OWNER_EMAIL = "abdallah.elficky@gmail.com";

async function issueTokenPair(user: User) {
  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    companyScope: user.companyScope,
  });

  const jti = generateInviteToken();
  const refreshToken = signRefreshToken({ sub: user.id, jti });
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: expiresInToDate(env.jwtRefreshExpiresIn),
    },
  });

  return { accessToken, refreshToken };
}

function publicUser(user: User) {
  const { passwordHash, inviteToken, ...rest } = user;
  return rest;
}

function publicTenant(tenant: Tenant) {
  const { unlockPin, ...rest } = tenant;
  return rest;
}

/**
 * يرفض تسجيل الدخول/تجديد الجلسة لشركة (Tenant) مُعلَّقة إدارياً من لوحة تحكم مدير المنصة
 * (athar-platform-admin، مشروع منفصل تماماً) أو انتهت فترتها التجريبية بلا ترقية. يُستدعى من
 * login()/refresh() فقط (وليس authenticate middleware نفسه، الذي يبقى تحققاً من التوقيع فقط بلا
 * أي استعلام لقاعدة البيانات) — فالتأثير الفعلي: رمز الدخول القديم لمستخدم شركة عُلِّقت للتو يبقى
 * صالحاً حتى انتهاء صلاحيته الطبيعية (15 دقيقة افتراضياً) بما أنه لا يستطيع تجديده بعدها.
 * حالتا subscriptionStatus الأخريان (past_due/canceled) لا تمنعان الدخول حالياً عمداً — إعلاميتان
 * فقط في هذه المرحلة (تُعرَضان في لوحة تحكم مدير المنصة)، وليستا "منتهي" أو "معلَّق" صراحةً.
 */
function assertTenantActive(tenant: Tenant) {
  if (tenant.subscriptionStatus === "suspended") {
    throw unauthorized(
      tenant.suspensionReason
        ? `تم تعليق هذا الحساب من إدارة المنصة: ${tenant.suspensionReason}`
        : "تم تعليق هذا الحساب من إدارة المنصة، تواصل مع الدعم الفني",
    );
  }
  if (tenant.subscriptionStatus === "trialing" && tenant.trialEndsAt && tenant.trialEndsAt < new Date()) {
    throw unauthorized("انتهت الفترة التجريبية لهذا الحساب، تواصل مع الدعم الفني لتفعيل الاشتراك");
  }
}

export async function register(
  input: { tenantName: string; businessActivity: BusinessActivity; name: string; email: string; password: string },
  lang: Lang = "ar",
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict("هذا البريد الإلكتروني مسجّل بالفعل");

  const passwordHash = await hashPassword(input.password);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
  const unlockPinHash = await hashPassword(env.defaultUnlockPin);

  const { tenant, user } = await prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.tenantName,
          subscriptionStatus: "trialing",
          trialEndsAt,
          unlockPin: unlockPinHash,
        },
      });

      const company = await tx.company.create({ data: { tenantId: tenant.id, name: input.tenantName, businessActivity: input.businessActivity } });
      const idByCode = await createChartFromTemplate(tx, tenant.id, company.id, CHART_TEMPLATE_BY_ACTIVITY[input.businessActivity]);
      await createStarterItems(tx, tenant.id, company.id, input.businessActivity, idByCode);
      await createCashParties(tx, tenant.id, company.id);
      await createDefaultWarehouse(tx, tenant.id, company.id);

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: input.name,
          email: input.email,
          passwordHash,
          role: input.email.toLowerCase() === OWNER_EMAIL ? "super_admin" : "admin",
          companyScope: "all",
          active: true,
          inviteStatus: "accepted",
        },
      });

      return { tenant, user };
    },
    // مهلة أطول من الافتراضي (5 ثوانٍ) كإجراء احتياطي إضافي — لم يعد زرع الشجرة القياسية
    // بحاجة إليها فعلياً بعد التحويل إلى createMany دفعي واحد، لكنها تحمي من أي بطء عابر
    // في اتصال قاعدة بيانات الإنتاج (بدء تشغيل بارد، ازدحام مؤقت، ...).
    { timeout: 20_000, maxWait: 10_000 },
  );

  const tokens = await issueTokenPair(user);

  // فشل إرسال الإيميل الترحيبي (خدمة Resend متوقفة مثلاً) لا يجب أن يُفشل التسجيل نفسه — يُسجَّل
  // الخطأ فقط ويكمل الحساب الجديد إنشاءه بنجاح.
  try {
    await sendWelcomeEmail(user.email, user.name, tenant.name, lang);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("فشل إرسال إيميل الترحيب:", err);
  }

  return { tenant: publicTenant(tenant), user: publicUser(user), ...tokens, emailServiceConfigured: Boolean(env.resendApiKey), platformNotices: [] as never[] };
}

export async function login(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash) throw unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة");
  if (!user.active) throw unauthorized("هذا الحساب معطّل، تواصل مع مدير النظام لديك");

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  assertTenantActive(tenant);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await issueTokenPair(user);
  const platformNotices = await prisma.platformNotice.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" } });
  return { tenant: publicTenant(tenant), user: publicUser(user), ...tokens, emailServiceConfigured: Boolean(env.resendApiKey), platformNotices };
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw unauthorized("رمز التحديث غير صالح أو منتهي الصلاحية");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.userId !== payload.sub) {
    throw unauthorized("رمز التحديث غير صالح أو منتهي الصلاحية");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) throw unauthorized("الحساب غير موجود أو معطّل");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  assertTenantActive(tenant);

  // تدوير: إبطال الرمز القديم فور استخدامه لمنع إعادة استخدامه (refresh token rotation)
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  return issueTokenPair(user);
}

export async function logout(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function invite(
  tenantId: string,
  input: { name: string; email: string; role: string; companyScope: string },
  lang: Lang = "ar",
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict("هذا البريد الإلكتروني مسجّل بالفعل");

  const inviteToken = generateInviteToken();
  const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRES_DAYS * 86_400_000);

  const user = await prisma.user.create({
    data: {
      tenantId,
      name: input.name,
      email: input.email,
      role: input.role as User["role"],
      companyScope: input.companyScope,
      active: true,
      inviteStatus: "pending",
      inviteToken,
      inviteExpiresAt,
    },
  });

  const emailSent = await trySendInviteEmail(input.email, inviteToken, lang);
  return { ...publicUser(user), emailSent };
}

/** يُعيد إنشاء رابط دعوة جديد لمستخدم "معلّق" لم يفعّل حسابه بعد (رابطه القديم منتهٍ أو ضائع). */
export async function resendInvite(tenantId: string, userId: string, lang: Lang = "ar") {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw notFound("المستخدم غير موجود");
  if (user.inviteStatus !== "pending") throw badRequest("هذا المستخدم مفعَّل حسابه بالفعل");

  const inviteToken = generateInviteToken();
  const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRES_DAYS * 86_400_000);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { inviteToken, inviteExpiresAt },
  });

  const emailSent = await trySendInviteEmail(updated.email, inviteToken, lang);
  return { ...publicUser(updated), emailSent };
}

/** فشل إرسال إيميل الدعوة (خدمة Resend متوقفة مثلاً) لا يجب أن يُفشل إنشاء المستخدم نفسه —
 * يُسجَّل الخطأ فقط، ويُعاد `false` حتى تعرض الواجهة تنبيهاً بعدم وصول الدعوة فعلياً. */
async function trySendInviteEmail(email: string, inviteToken: string, lang: Lang = "ar"): Promise<boolean> {
  try {
    await sendInviteEmail(email, `/accept-invite?token=${inviteToken}`, lang);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("فشل إرسال إيميل الدعوة:", err);
    return false;
  }
}

export async function listUsers(tenantId: string) {
  const users = await prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  return users.map(publicUser);
}

export async function acceptInvite(input: { token: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { inviteToken: input.token } });
  if (!user) throw notFound("رابط الدعوة غير صالح");
  if (user.inviteStatus === "accepted") throw badRequest("تم قبول هذه الدعوة مسبقاً");
  if (!user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
    throw badRequest("انتهت صلاحية رابط الدعوة، اطلب من مدير النظام دعوة جديدة");
  }

  const passwordHash = await hashPassword(input.password);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, inviteStatus: "accepted", inviteToken: null, inviteExpiresAt: null },
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: updated.tenantId } });
  assertTenantActive(tenant);
  const tokens = await issueTokenPair(updated);
  const platformNotices = await prisma.platformNotice.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" } });
  return { tenant: publicTenant(tenant), user: publicUser(updated), ...tokens, emailServiceConfigured: Boolean(env.resendApiKey), platformNotices };
}

export async function changeUnlockPin(tenantId: string, currentPin: string, newPin: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const valid = await verifyPassword(currentPin, tenant.unlockPin);
  if (!valid) throw badRequest("الرقم السري الحالي غير صحيح");

  const newHash = await hashPassword(newPin);
  await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: newHash } });
}

/**
 * تصحيح اسم المنشأة/المستأجر بعد الإنشاء — لا يوجد مسار آخر لتعديله (التسجيل لا يسمح
 * بإعادة تسمية المستأجر لاحقاً)، وهذا ضروري خصوصاً لو أُدخل الاسم بترميز خاطئ في وقت
 * التسجيل الأول (مثلاً عبر إدخال يدوي مباشر في قاعدة البيانات بترميز غير UTF-8).
 */
export async function updateTenantName(tenantId: string, name: string) {
  const updated = await prisma.tenant.update({ where: { id: tenantId }, data: { name } });
  return publicTenant(updated);
}

/**
 * تُقرأ فور فتح التطبيق (انظر AuthContext) لتحديث بيانات المستخدم/المستأجر المخزَّنة محلياً
 * بأحدث قيمة من قاعدة البيانات، بدل الاكتفاء بما كان محفوظاً في localStorage وقت آخر تسجيل
 * دخول — وإلا فإن أي تصحيح لاحق لاسم المستأجر أو المستخدم (كإصلاح ترميز خاطئ) لن ينعكس في
 * جلسة مفتوحة بالفعل إلا بعد تسجيل خروج ودخول يدوي.
 */
export async function getMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  // تُستدعى هذه الدالة عند كل فتح تطبيق (انظر AuthContext) — إعادة فحص حالة الاشتراك هنا أيضاً
  // (وليس فقط عند login/refresh) تعني أن تعليق شركة يُطرد مستخدميها المسجَّلين بالفعل فور أول
  // إعادة تحميل للصفحة، لا فقط عند انتهاء صلاحية رمزهم الحالي.
  assertTenantActive(tenant);
  const platformNotices = await prisma.platformNotice.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" } });
  // مؤشّر تشخيصي للوحة الإدارة فقط (مجرد boolean، بلا كشف أي سرّ) — انظر التحذير المطابق عند
  // إقلاع الخادم في server.ts لنفس السبب.
  return { user: publicUser(user), tenant: publicTenant(tenant), emailServiceConfigured: Boolean(env.resendApiKey), platformNotices };
}

export async function updateMyName(userId: string, name: string) {
  const updated = await prisma.user.update({ where: { id: userId }, data: { name } });
  return publicUser(updated);
}

/**
 * يُرجع دائماً نفس الرسالة العامة (FORGOT_PASSWORD_MESSAGE) بصرف النظر عن وجود البريد من
 * عدمه، أو تعطيل الحساب، أو تجاوز حد الطلبات — لمنع أي طرف من استخدام هذا المسار لاكتشاف
 * البريد الإلكتروني لمستخدم حقيقي بالنظام عبر تجربة عناوين عشوائية.
 */
export async function forgotPassword(email: string, lang: Lang = "ar") {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.active) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequests = await prisma.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gte: oneHourAgo } },
    });
    // لو تجاوز حد الطلبات: نتجاهل الطلب بصمت (بدون إنشاء رمز جديد ولا إرسال إيميل) لكن نظل
    // نُرجع نفس الرسالة العامة أدناه، حتى لا يُكشَف الفارق بين "لا يوجد بريد كهذا" و"البريد
    // موجود لكن تم تجاوز حد الطلبات" من خلال اختلاف الاستجابة.
    if (recentRequests < PASSWORD_RESET_MAX_PER_HOUR) {
      const rawToken = generateInviteToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_MINUTES * 60_000);
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
      await sendPasswordResetEmail(user.email, rawToken, lang);
    }
  }
  return FORGOT_PASSWORD_MESSAGE;
}

export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token);
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw badRequest("الرابط غير صالح أو منتهي الصلاحية، يرجى طلب رابط جديد");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    // إبطال كل جلسات هذا المستخدم المفتوحة على أي جهاز فور نجاح إعادة التعيين — إجراء أمني
    // مقصود، بنفس منطق إبطال رمز واحد عند logout لكن مطبَّق على كل رموز التحديث غير المُبطَلة.
    prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}
