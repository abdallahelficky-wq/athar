import { prisma } from "../../lib/prisma";
import { hashPassword, verifyPassword } from "../../lib/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateInviteToken,
  expiresInToDate,
  signIdentityChoiceToken,
  verifyIdentityChoiceToken,
} from "../../lib/jwt";
import { env } from "../../config/env";
import { createChartFromTemplate } from "../../lib/defaultChartOfAccounts";
import { CHART_TEMPLATE_BY_ACTIVITY, BusinessActivity } from "../../lib/chartTemplates";
import { createStarterItems, createCashParties, createDefaultWarehouse } from "../../lib/starterData";
import { sendInviteEmail, sendPasswordResetEmail, sendWelcomeEmail } from "../../lib/mailer";
import { badRequest, conflict, notFound, unauthorized } from "../../lib/httpError";
import type { Lang } from "../../lib/i18n/translate";
import type { Tenant, User, Identity } from "@prisma/client";
import { canUnpostJournalEntries, canDeferPosSale } from "../positions/positions.service";

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

type UserWithIdentity = User & { identity: Identity };

async function issueTokenPair(user: User, readOnly: boolean) {
  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    companyScope: user.companyScope,
    readOnly,
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

/** email يأتي الآن من Identity المرتبطة (user.identity.email) بدل حقل مباشر على User نفسه. */
function publicUser(user: UserWithIdentity) {
  const { identity, identityId: _identityId, inviteToken, ...rest } = user;
  return { ...rest, email: identity.email };
}

/** publicUser + مؤشّرات canUnpostJournalEntries/canDeferPosSale — حتى تعرف الواجهة متى تُظهر زر
 * "فك الترحيل"/تبويب "آجل" في نقطة البيع أصلاً (راجع positions.service.ts) بدل الاعتماد فقط على
 * رفض الخادم لاحقاً. readOnly تُمرَّر صراحةً من الطرف المستدعي (وليست تُحسَب هنا) لأنها محسوبة
 * بالفعل مرة واحدة في completeLoginForUser/getMe، فتفادياً لاستعلام Tenant مكرر. */
async function publicUserWithPermissions(user: UserWithIdentity, readOnly: boolean) {
  return {
    ...publicUser(user),
    canUnpostJournalEntries: await canUnpostJournalEntries(user.tenantId, user.id, user.role),
    canDeferPosSale: await canDeferPosSale(user.tenantId, user.id, user.role),
    readOnly,
  };
}

function publicTenant(tenant: Tenant) {
  const { unlockPin, ...rest } = tenant;
  return rest;
}

/**
 * يرفض تسجيل الدخول/تجديد الجلسة كلياً فقط لشركة (Tenant) مُعلَّقة إدارياً من لوحة تحكم مدير
 * المنصة (athar-platform-admin، مشروع منفصل تماماً) — إجراء إداري متعمَّد (غالباً إساءة استخدام أو
 * نزاع دفع)، أشد من مجرد انتهاء اشتراك عادي، فيبقى رفضاً كاملاً كما كان. انتهاء الفترة التجريبية أو
 * تعطّل السداد (past_due/canceled) لم يعودا يمنعان الدخول إطلاقاً — يتحولان بدلاً من ذلك لوضع "عرض
 * فقط" عبر isTenantReadOnly أدناه (راجع blockMutationsWhenReadOnly في middleware/auth.ts للتطبيق
 * الفعلي). يُستدعى من completeLoginForUser/refresh/getMe فقط (وليس authenticate middleware نفسه،
 * الذي يبقى تحققاً من التوقيع فقط بلا أي استعلام لقاعدة البيانات) — فالتأثير الفعلي: رمز الدخول
 * القديم لمستخدم شركة عُلِّقت للتو يبقى صالحاً حتى انتهاء صلاحيته الطبيعية (15 دقيقة افتراضياً) بما
 * أنه لا يستطيع تجديده بعدها.
 */
function assertTenantActive(tenant: Tenant) {
  if (tenant.subscriptionStatus === "suspended") {
    throw unauthorized(
      tenant.suspensionReason
        ? `تم تعليق هذا الحساب من إدارة المنصة: ${tenant.suspensionReason}`
        : "تم تعليق هذا الحساب من إدارة المنصة، تواصل مع الدعم الفني",
    );
  }
}

/** true لو انتهت الفترة التجريبية بلا ترقية، أو تعطّل السداد (past_due)، أو أُلغي الاشتراك
 * (canceled) — في كل هذه الحالات يبقى الدخول والقراءة متاحين بالكامل، لكن أي إضافة/تعديل/حذف يُرفض
 * (راجع blockMutationsWhenReadOnly). محسوبة من حالة Tenant الخاصة بعضوية (User) واحدة بعينها فقط،
 * لا من الهوية (Identity) المشتركة — عضوية أخرى لنفس الشخص في شركة مختلفة غير متأثرة إطلاقاً. */
function isTenantReadOnly(tenant: Pick<Tenant, "subscriptionStatus" | "trialEndsAt">): boolean {
  if (tenant.subscriptionStatus === "trialing") {
    return Boolean(tenant.trialEndsAt && tenant.trialEndsAt < new Date());
  }
  return tenant.subscriptionStatus === "past_due" || tenant.subscriptionStatus === "canceled";
}

export async function register(
  input: { tenantName: string; businessActivity: BusinessActivity; name: string; email: string; password: string },
  lang: Lang = "ar",
) {
  const existingIdentity = await prisma.identity.findUnique({ where: { email: input.email } });
  // هوية موجودة بكلمة مرور بالفعل: يجب التحقق من كلمة المرور المُدخَلة مقابلها فعلياً قبل ربط أي
  // مستأجر جديد بها — بدون هذا الفحص، كتابة إيميل شخص آخر في نموذج تسجيل شركة جديدة كانت كافية
  // "للاستيلاء" على الانتماء لهويته بلا معرفة كلمة سرّه الحقيقية إطلاقاً.
  if (existingIdentity?.passwordHash) {
    const valid = await verifyPassword(input.password, existingIdentity.passwordHash);
    if (!valid) throw conflict("هذا البريد الإلكتروني مسجّل بالفعل بكلمة مرور مختلفة");
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
  const unlockPinHash = await hashPassword(env.defaultUnlockPin);

  const { tenant, user } = await prisma.$transaction(
    async (tx) => {
      const identity = existingIdentity
        ? existingIdentity.passwordHash
          ? existingIdentity
          // هوية موجودة بلا كلمة مرور بعد (أُنشئت عبر دعوة لم تُقبَل قط) — هذا أول ضبط فعلي لكلمة
          // مرورها، عبر تسجيل شركة جديدة بدل قبول تلك الدعوة القديمة.
          : await tx.identity.update({ where: { id: existingIdentity.id }, data: { passwordHash: await hashPassword(input.password) } })
        : await tx.identity.create({ data: { email: input.email, passwordHash: await hashPassword(input.password) } });

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
          identityId: identity.id,
          name: input.name,
          role: input.email.toLowerCase() === OWNER_EMAIL ? "super_admin" : "admin",
          companyScope: "all",
          active: true,
          inviteStatus: "accepted",
        },
        include: { identity: true },
      });

      // أول مستخدم يسجّل لهذه الشركة هو مالكها افتراضياً — يملك دائماً كل صلاحيات المناصب على
      // شركته (راجع requirePermission في middleware/auth.ts) بلا حاجة لإعداد منصب له صراحةً.
      // للشركات الأقدم من هذه الميزة، راجع scripts/backfillTenantOwners.ts.
      await tx.tenant.update({ where: { id: tenant.id }, data: { ownerId: user.id } });

      return { tenant: { ...tenant, ownerId: user.id }, user };
    },
    // مهلة أطول من الافتراضي (5 ثوانٍ) كإجراء احتياطي إضافي — لم يعد زرع الشجرة القياسية
    // بحاجة إليها فعلياً بعد التحويل إلى createMany دفعي واحد، لكنها تحمي من أي بطء عابر
    // في اتصال قاعدة بيانات الإنتاج (بدء تشغيل بارد، ازدحام مؤقت، ...).
    { timeout: 20_000, maxWait: 10_000 },
  );

  // شركة جديدة الإنشاء دائماً (تجريبية بالكاد بدأت) — لا يمكن أن تكون "عرض فقط" لحظة التسجيل نفسه.
  const tokens = await issueTokenPair(user, false);

  // فشل إرسال الإيميل الترحيبي (خدمة Resend متوقفة مثلاً) لا يجب أن يُفشل التسجيل نفسه — يُسجَّل
  // الخطأ فقط ويكمل الحساب الجديد إنشاءه بنجاح.
  try {
    await sendWelcomeEmail(user.identity.email, user.name, tenant.name, lang);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("فشل إرسال إيميل الترحيب:", err);
  }

  return { tenant: publicTenant(tenant), user: await publicUserWithPermissions(user, false), readOnly: false, ...tokens, emailServiceConfigured: Boolean(env.resendApiKey), platformNotices: [] as never[] };
}

async function completeLoginForUser(user: UserWithIdentity) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  assertTenantActive(tenant);
  const readOnly = isTenantReadOnly(tenant);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await issueTokenPair(user, readOnly);
  const platformNotices = await prisma.platformNotice.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" } });
  return { tenant: publicTenant(tenant), user: await publicUserWithPermissions(user, readOnly), readOnly, ...tokens, emailServiceConfigured: Boolean(env.resendApiKey), platformNotices };
}

/**
 * تسجيل الدخول أصبح خطوتين محتملتين: التحقق من الهوية (بريد + كلمة مرور مشتركان بين كل عضويات
 * نفس الشخص) هنا أولاً — فلو كانت له عضوية واحدة فقط (الحالة الشائعة)، يُصدَر رمز دخول كامل مباشرة
 * كما كان يحدث دائماً بلا أي تغيير في التجربة. لو كانت له أكثر من عضوية (ينتمي لعدة شركات منفصلة
 * بنفس البريد)، لا يُصدَر أي رمز دخول حقيقي بعد إطلاقاً — فقط رمز اختيار قصير الأجل (5 دقائق)، ريثما
 * يختار عبر completeLoginChoice() أي عضوية يريد الدخول إليها فعلياً؛ عندها فقط يُصدَر رمز الدخول
 * الحقيقي لتلك العضوية تحديداً. مبدأ حاسم: كل تبديل بين شركات نفس الهوية لاحقاً هو دائماً إصدار
 * رمز جديد فعلياً بهذه الآلية بالضبط، لا أي تعديل حالة عميل-فقط على رمز موجود.
 */
export async function login(input: { email: string; password: string }) {
  const identity = await prisma.identity.findUnique({ where: { email: input.email } });
  if (!identity || !identity.passwordHash) throw unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة");

  const valid = await verifyPassword(input.password, identity.passwordHash);
  if (!valid) throw unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة");

  const memberships = await prisma.user.findMany({
    where: { identityId: identity.id, inviteStatus: "accepted" },
    include: { identity: true },
  });
  if (memberships.length === 0) throw unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة");

  const usable = memberships.filter((m) => m.active);
  if (usable.length === 0) throw unauthorized("هذا الحساب معطّل، تواصل مع مدير النظام لديك");

  if (usable.length === 1) return completeLoginForUser(usable[0]);

  const identityToken = signIdentityChoiceToken({ identityId: identity.id });
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: usable.map((m) => m.tenantId) } },
    select: { id: true, name: true, subscriptionStatus: true, trialEndsAt: true, suspensionReason: true },
  });
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  return {
    chooseAccount: true as const,
    identityToken,
    // readOnly هنا للعرض فقط في شاشة اختيار الشركة (يعرف المستخدم مسبقاً أي عضوية بوضع "عرض فقط"
    // قبل اختيارها) — التحقق الفعلي الملزم يبقى دائماً في completeLoginChoice/completeLoginForUser
    // لحظة إصدار الرمز الحقيقي، لا هنا.
    accounts: usable.map((m) => {
      const tenant = tenantById.get(m.tenantId);
      return {
        userId: m.id,
        tenantId: m.tenantId,
        tenantName: tenant?.name || "",
        role: m.role,
        readOnly: tenant ? isTenantReadOnly(tenant) : false,
      };
    }),
  };
}

/** الخطوة الثانية من تسجيل الدخول عند تعدّد العضويات — تتحقق من رمز الاختيار (مرتبط حصراً بنفس
 * الهوية التي نجح تحقق كلمة مرورها في login() فقط) ثم تصدر رمز دخول حقيقي للعضوية المختارة. */
export async function completeLoginChoice(identityToken: string, userId: string) {
  let payload;
  try {
    payload = verifyIdentityChoiceToken(identityToken);
  } catch {
    throw unauthorized("انتهت صلاحية عملية تسجيل الدخول، ابدأ من جديد");
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, identityId: payload.identityId, inviteStatus: "accepted" },
    include: { identity: true },
  });
  if (!user) throw notFound("الحساب غير موجود");
  if (!user.active) throw unauthorized("هذا الحساب معطّل، تواصل مع مدير النظام لديك");

  return completeLoginForUser(user);
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

  // يُعاد حساب وضع "عرض فقط" من جديد في كل تجديد (لا يُنسَخ من الرمز القديم) — تفعيل الاشتراك بعد
  // انتهاء تجريبي/تعطّل سداد ينعكس تلقائياً خلال 15 دقيقة كحد أقصى (مدة صلاحية رمز الدخول) بلا حاجة
  // لتسجيل خروج/دخول، تماماً كما يحدث فعلياً لعكس تعليق الشركة إدارياً.
  return issueTokenPair(user, isTenantReadOnly(tenant));
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
  const existingIdentity = await prisma.identity.findUnique({ where: { email: input.email } });
  if (existingIdentity) {
    const existingMembership = await prisma.user.findUnique({
      where: { identityId_tenantId: { identityId: existingIdentity.id, tenantId } },
    });
    if (existingMembership) throw conflict("هذا البريد الإلكتروني مسجّل بالفعل في هذه الشركة");
  }

  const inviteToken = generateInviteToken();
  const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRES_DAYS * 86_400_000);

  const identity = existingIdentity ?? (await prisma.identity.create({ data: { email: input.email } }));

  const user = await prisma.user.create({
    data: {
      tenantId,
      identityId: identity.id,
      name: input.name,
      role: input.role as User["role"],
      companyScope: input.companyScope,
      active: true,
      inviteStatus: "pending",
      inviteToken,
      inviteExpiresAt,
    },
    include: { identity: true },
  });

  const emailSent = await trySendInviteEmail(input.email, inviteToken, lang);
  return { ...publicUser(user), emailSent };
}

/** يُعيد إنشاء رابط دعوة جديد لمستخدم "معلّق" لم يفعّل حسابه بعد (رابطه القديم منتهٍ أو ضائع). */
export async function resendInvite(tenantId: string, userId: string, lang: Lang = "ar") {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId }, include: { identity: true } });
  if (!user) throw notFound("المستخدم غير موجود");
  if (user.inviteStatus !== "pending") throw badRequest("هذا المستخدم مفعَّل حسابه بالفعل");

  const inviteToken = generateInviteToken();
  const inviteExpiresAt = new Date(Date.now() + INVITE_EXPIRES_DAYS * 86_400_000);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { inviteToken, inviteExpiresAt },
    include: { identity: true },
  });

  const emailSent = await trySendInviteEmail(updated.identity.email, inviteToken, lang);
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
  const users = await prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, include: { identity: true } });
  return users.map(publicUser);
}

/** يمنع المستخدم من تسجيل الدخول فوراً (auth.service.ts's login/refresh يتحققان من active بالفعل)
 * بلا حذف أي شيء — سجله وكل ما أنشأه (قيود، مرفقات...) يبقى كما هو تماماً. */
export async function setUserActive(tenantId: string, actingUserId: string, userId: string, active: boolean) {
  if (userId === actingUserId) throw badRequest("لا يمكنك تعطيل حسابك أنت شخصياً");
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw notFound("المستخدم غير موجود");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { ownerId: true } });
  if (tenant.ownerId === userId) throw badRequest("لا يمكن تعطيل مالك الشركة");

  const updated = await prisma.user.update({ where: { id: userId }, data: { active }, include: { identity: true } });
  return publicUser(updated);
}

/**
 * حذف نهائي — يُرفَض لو كان المستخدم قد أنشأ أي قيد يومية أو رفع أي مرفق (createdBy/uploadedBy
 * مرجعان حرّان بلا FK صارم في المخطط أصلاً، فحذف المستخدم لن يفشل على مستوى قاعدة البيانات، لكنه
 * سيترك تلك السجلات بمرجع "من أنشأها" معلَّقاً بلا أي طريقة لاحقاً لمعرفة صاحبه — غير مقبول في
 * نظام محاسبي). التعطيل (setUserActive) هو البديل الدائم الصحيح في هذه الحالة: يمنع الدخول
 * فعلياً مع الحفاظ الكامل على أثر "من أنشأ ماذا". الجداول الأخرى المرتبطة بالمستخدم مباشرة عبر FK
 * حقيقي (RefreshToken/UserActionPermissionOverride) تُحذَف تلقائياً معه (onDelete: Cascade)،
 * وAuditLog يبقى بصفّه لكن userId يُصفَّر (onDelete: SetNull) — سلوك موجود أصلاً في المخطط، لا
 * تغيير مطلوب هنا. Identity المرتبطة (البريد/كلمة المرور) لا تُحذَف أبداً هنا حتى لو كانت هذه
 * آخر عضوية لها — قد يُدعى نفس البريد لاحقاً لشركة أخرى، فتبقى هويته قائمة بصرف النظر عن مصير
 * عضوياته الفردية.
 */
export async function deleteUser(tenantId: string, actingUserId: string, userId: string) {
  if (userId === actingUserId) throw badRequest("لا يمكنك حذف حسابك أنت شخصياً");
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw notFound("المستخدم غير موجود");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { ownerId: true } });
  if (tenant.ownerId === userId) throw badRequest("لا يمكن حذف مالك الشركة");

  const [journalEntryCount, attachmentCount] = await Promise.all([
    prisma.journalEntry.count({ where: { createdBy: userId } }),
    prisma.attachment.count({ where: { uploadedBy: userId } }),
  ]);
  if (journalEntryCount || attachmentCount) {
    const reasons = [
      journalEntryCount ? `${journalEntryCount} قيد يومية` : "",
      attachmentCount ? `${attachmentCount} مرفق` : "",
    ].filter(Boolean).join(" و");
    throw badRequest(`لا يمكن حذف هذا المستخدم نهائياً لارتباطه بإنشاء ${reasons} — عطّله بدلاً من ذلك للحفاظ على سجل "من أنشأها".`);
  }

  await prisma.user.delete({ where: { id: userId } });
}

/**
 * معلومات دعوة للعرض قبل أي إجراء — تحدّد للواجهة هل تُظهر حقلَي كلمة مرور (هوية جديدة تماماً)
 * أم زر "تأكيد الانضمام" فقط بلا كلمة مرور (هوية موجودة مسبقاً بكلمة مرور بالفعل من مستأجر آخر).
 * قرائية بحتة، لا تُغيّر أي حالة.
 */
export async function getInviteInfo(token: string) {
  const user = await prisma.user.findUnique({
    where: { inviteToken: token },
    include: { identity: true, tenant: { select: { name: true } } },
  });
  if (!user) throw notFound("رابط الدعوة غير صالح");
  if (user.inviteStatus === "accepted") throw badRequest("تم قبول هذه الدعوة مسبقاً");
  if (!user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
    throw badRequest("انتهت صلاحية رابط الدعوة، اطلب من مدير النظام دعوة جديدة");
  }
  return {
    name: user.name,
    email: user.identity.email,
    tenantName: user.tenant.name,
    role: user.role,
    requiresPassword: !user.identity.passwordHash,
  };
}

export async function acceptInvite(input: { token: string; password?: string }) {
  const user = await prisma.user.findUnique({ where: { inviteToken: input.token }, include: { identity: true } });
  if (!user) throw notFound("رابط الدعوة غير صالح");
  if (user.inviteStatus === "accepted") throw badRequest("تم قبول هذه الدعوة مسبقاً");
  if (!user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
    throw badRequest("انتهت صلاحية رابط الدعوة، اطلب من مدير النظام دعوة جديدة");
  }

  if (!user.identity.passwordHash) {
    // هوية جديدة تماماً (لا كلمة مرور بعد) — يجب تحديد كلمة مرور الآن، بنفس التحقق المطبَّق أصلاً
    // في acceptInviteSchema (8 أحرف على الأقل) — يُعاد هنا احتياطاً لو استُدعيت الدالة مباشرة.
    if (!input.password || input.password.length < 8) throw badRequest("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    const passwordHash = await hashPassword(input.password);
    await prisma.identity.update({ where: { id: user.identityId }, data: { passwordHash } });
  }
  // وإلا (هوية موجودة بكلمة مرور بالفعل من عضوية أخرى): مجرد تأكيد الانضمام لهذه الشركة تحديداً،
  // بلا أي كلمة مرور جديدة — أي password مُرسَل هنا يُتجاهَل عمداً، فلا تُستبدَل كلمة مرور هوية
  // قائمة بمجرد قبول دعوة لشركة أخرى.

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { inviteStatus: "accepted", inviteToken: null, inviteExpiresAt: null },
    include: { identity: true },
  });

  // نفس منطق تسجيل الدخول بالضبط بعد قبول الدعوة (فحص حالة الشركة، حساب readOnly، إصدار الرمزين،
  // تحديث lastLoginAt، الإشعارات) — إعادة استخدام completeLoginForUser بدل تكرار كل هذا يدوياً هنا.
  return completeLoginForUser(updated);
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
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { identity: true } });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  // تُستدعى هذه الدالة عند كل فتح تطبيق (انظر AuthContext) — إعادة فحص حالة الاشتراك هنا أيضاً
  // (وليس فقط عند login/refresh) تعني أن تعليق شركة يُطرد مستخدميها المسجَّلين بالفعل فور أول
  // إعادة تحميل للصفحة، لا فقط عند انتهاء صلاحية رمزهم الحالي. لم تعد تُستخدَم لطرد شركة انتهت
  // فترتها التجريبية فقط (تصبح "عرض فقط" بدلاً من ذلك) — فقط للتعليق الإداري الفعلي.
  assertTenantActive(tenant);
  const readOnly = isTenantReadOnly(tenant);
  const platformNotices = await prisma.platformNotice.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" } });
  // مؤشّر تشخيصي للوحة الإدارة فقط (مجرد boolean، بلا كشف أي سرّ) — انظر التحذير المطابق عند
  // إقلاع الخادم في server.ts لنفس السبب.
  return { user: await publicUserWithPermissions(user, readOnly), tenant: publicTenant(tenant), readOnly, emailServiceConfigured: Boolean(env.resendApiKey), platformNotices };
}

export async function updateMyName(userId: string, name: string) {
  const updated = await prisma.user.update({ where: { id: userId }, data: { name }, include: { identity: true } });
  return publicUser(updated);
}

/**
 * يُرجع دائماً نفس الرسالة العامة (FORGOT_PASSWORD_MESSAGE) بصرف النظر عن وجود البريد من
 * عدمه، أو تعطيل الحساب، أو تجاوز حد الطلبات — لمنع أي طرف من استخدام هذا المسار لاكتشاف
 * البريد الإلكتروني لمستخدم حقيقي بالنظام عبر تجربة عناوين عشوائية.
 */
export async function forgotPassword(email: string, lang: Lang = "ar") {
  const identity = await prisma.identity.findUnique({ where: { email } });
  if (identity && identity.passwordHash) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequests = await prisma.passwordResetToken.count({
      where: { identityId: identity.id, createdAt: { gte: oneHourAgo } },
    });
    // لو تجاوز حد الطلبات: نتجاهل الطلب بصمت (بدون إنشاء رمز جديد ولا إرسال إيميل) لكن نظل
    // نُرجع نفس الرسالة العامة أدناه، حتى لا يُكشَف الفارق بين "لا يوجد بريد كهذا" و"البريد
    // موجود لكن تم تجاوز حد الطلبات" من خلال اختلاف الاستجابة.
    if (recentRequests < PASSWORD_RESET_MAX_PER_HOUR) {
      const rawToken = generateInviteToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_MINUTES * 60_000);
      await prisma.passwordResetToken.create({ data: { identityId: identity.id, tokenHash, expiresAt } });
      await sendPasswordResetEmail(identity.email, rawToken, lang);
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
    prisma.identity.update({ where: { id: stored.identityId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    // يُبطِل جلسات كل عضويات هذه الهوية عبر كل الشركات المنتمية إليها، لا عضوية واحدة فقط —
    // كلمة المرور مشتركة بينها جميعاً الآن، بنفس منطق إبطال جلسة واحدة عند logout لكن موسَّعاً
    // ليغطي كل الشركات دفعة واحدة.
    prisma.refreshToken.updateMany({ where: { user: { identityId: stored.identityId }, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}
