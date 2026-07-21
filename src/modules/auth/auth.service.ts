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
import { DEFAULT_CHART_OF_ACCOUNTS } from "../../lib/defaultChartOfAccounts";
import { sendInviteEmail } from "../../lib/mailer";
import { badRequest, conflict, notFound, unauthorized } from "../../lib/httpError";
import type { Tenant, User } from "@prisma/client";

const TRIAL_DAYS = 30;
const INVITE_EXPIRES_DAYS = 7;

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

export async function register(input: { tenantName: string; name: string; email: string; password: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict("هذا البريد الإلكتروني مسجّل بالفعل");

  const passwordHash = await hashPassword(input.password);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
  const unlockPinHash = await hashPassword(env.defaultUnlockPin);

  const { tenant, user } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.tenantName,
        subscriptionStatus: "trialing",
        trialEndsAt,
        unlockPin: unlockPinHash,
      },
    });

    await tx.account.createMany({
      data: DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ tenantId: tenant.id, name: a.name, type: a.type })),
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: input.name,
        email: input.email,
        passwordHash,
        role: "admin",
        companyScope: "all",
        active: true,
        inviteStatus: "accepted",
      },
    });

    return { tenant, user };
  });

  const tokens = await issueTokenPair(user);
  return { tenant: publicTenant(tenant), user: publicUser(user), ...tokens };
}

export async function login(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash) throw unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة");
  if (!user.active) throw unauthorized("هذا الحساب معطّل، تواصل مع مدير النظام لديك");

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة");

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const tokens = await issueTokenPair(user);
  return { tenant: publicTenant(tenant), user: publicUser(user), ...tokens };
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

  const activationLink = `/accept-invite?token=${inviteToken}`;
  await sendInviteEmail(input.email, activationLink);

  return publicUser(user);
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
  const tokens = await issueTokenPair(updated);
  return { tenant: publicTenant(tenant), user: publicUser(updated), ...tokens };
}

export async function changeUnlockPin(tenantId: string, currentPin: string, newPin: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const valid = await verifyPassword(currentPin, tenant.unlockPin);
  if (!valid) throw badRequest("الرقم السري الحالي غير صحيح");

  const newHash = await hashPassword(newPin);
  await prisma.tenant.update({ where: { id: tenantId }, data: { unlockPin: newHash } });
}
