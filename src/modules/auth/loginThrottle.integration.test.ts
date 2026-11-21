import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../lib/password";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { HttpError } from "../../lib/httpError";
import { login, LOGIN_MAX_FAILURES_PER_EMAIL, LOGIN_MAX_FAILURES_PER_IP } from "./auth.service";

/**
 * حدّ محاولات الدخول الفاشلة للنظام الرئيسي على Postgres حقيقي (جدول portal_login_throttle نفسه):
 * - بعد LOGIN_MAX_FAILURES_PER_EMAIL محاولة خاطئة لبريد واحد يُرفَض حتى الصحيح بـ429 (من أي IP)؛
 * - بعد LOGIN_MAX_FAILURES_PER_IP محاولة خاطئة من IP واحد على بريدات مختلفة يُرفَض ذلك الـIP بـ429؛
 * - البريد يُطبَّع (حالة الأحرف) فلا يتجاوز أحد الحدّ بتغيير الحروف.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const stamp = Date.now();
const password = "Str0ng-Pass!";
const identityEmail = `throttle-${stamp}@example.com`;

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as HttpError;
  }
  throw new Error("expected the login to fail");
}

describe("main login throttle (integration)", () => {
  beforeAll(async () => {
    await prisma.identity.create({ data: { email: identityEmail, passwordHash: await hashPassword(password) } });
  }, 60_000);

  afterAll(async () => {
    await prisma.identity.deleteMany({ where: { email: identityEmail } });
    await prisma.portalLoginThrottle.deleteMany({ where: { key: { contains: `${stamp}` } } });
  });

  it("wrong passwords lock the email after the limit — even the right password, from another IP, in upper case", async () => {
    const ip = `203.0.113.1-${stamp}`;
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_EMAIL; i++) {
      const err = await failure(login({ email: identityEmail, password: "wrong" }, ip));
      expect(err.status).toBe(401);
    }
    // حتى كلمة المرور الصحيحة تُرفَض الآن، ومن IP آخر، وبحروف كبيرة
    const blocked = await failure(login({ email: identityEmail.toUpperCase(), password }, `203.0.113.2-${stamp}`));
    expect(blocked.status).toBe(429);
  });

  it("one IP trying many emails is throttled after the per-IP limit", async () => {
    const ip = `203.0.113.9-${stamp}`;
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IP; i++) {
      const err = await failure(login({ email: `nobody-${i}-${stamp}@example.com`, password: "x" }, ip));
      expect(err.status).toBe(401);
    }
    const blocked = await failure(login({ email: `another-${stamp}@example.com`, password: "x" }, ip));
    expect(blocked.status).toBe(429);
  });
});
