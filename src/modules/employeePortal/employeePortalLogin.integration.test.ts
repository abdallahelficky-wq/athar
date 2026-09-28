import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { hashPassword } from "../../lib/password";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { HttpError } from "../../lib/httpError";
import { verifyEmployeePortalToken, signEmployeePortalToken } from "../../lib/jwt";
import { authenticateEmployeePortal } from "../../middleware/auth";
import {
  employeePortalLogin,
  INVALID_LOGIN_MESSAGE,
  MAX_FAILED_ATTEMPTS,
  BASE_LOCK_MS,
  lockDurationMs,
} from "./employeePortal.service";
import { MAX_FAILURES_PER_IP } from "./loginThrottle";

/**
 * اختبارات تكامل على Postgres حقيقي لدخول بوابة الموظف: رمز المنشأة الرقمي بجوار المعرّف القديم،
 * الرد الموحّد لكل حالات الفشل (بما فيها الحساب المقفل)، القفل المتصاعد دون تصفير العدّاد، حدّ
 * المحاولات لكل IP، تعليق المنشأة، وعدم خروج تجزئة PIN من أي استعلام افتراضي.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const PIN = "482193";
const PHONE = "0501112233";
let ipCounter = 0;
const freshIp = () => `198.51.100.${++ipCounter}-${Date.now()}`;

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as HttpError;
  }
  throw new Error("expected the login to fail");
}

describe("employee portal login (integration)", () => {
  let tenantId: string;
  let tenantCode: number;
  let otherTenantId: string;
  let companyId: string;
  let employeeId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Portal Login Tenant", unlockPin: "hashed" } });
    tenantId = tenant.id;
    tenantCode = tenant.code;
    otherTenantId = (await prisma.tenant.create({ data: { name: "Portal Login Other", unlockPin: "hashed" } })).id;
    companyId = (await prisma.company.create({ data: { tenantId, name: "Station Co" } })).id;
    employeeId = (
      await prisma.employee.create({
        data: {
          tenantId,
          companyId,
          name: "عامل محطة",
          hireDate: new Date("2026-01-01"),
          basicSalary: 3000,
          phone: PHONE,
          pinHash: await hashPassword(PIN),
          portalActive: true,
        },
      })
    ).id;
  }, 60_000);

  beforeEach(async () => {
    await prisma.employee.update({
      where: { id: employeeId },
      data: { failedPortalLoginAttempts: 0, portalLockedUntil: null, portalLockoutCount: 0, portalActive: true, status: "active" },
    });
    await prisma.tenant.update({ where: { id: tenantId }, data: { subscriptionStatus: "trialing", suspensionReason: null } });
  });

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.portalLoginThrottle.deleteMany({ where: { key: { startsWith: "ip:198.51.100." } } });
  });

  it("gives every tenant a unique numeric code from the sequence (>= 1000001)", async () => {
    const other = await prisma.tenant.findUniqueOrThrow({ where: { id: otherTenantId } });
    expect(tenantCode).toBeGreaterThanOrEqual(1000001);
    expect(other.code).toBeGreaterThan(tenantCode);
  });

  it("logs in with the numeric company code, and the token carries the internal tenant id", async () => {
    const result = await employeePortalLogin(String(tenantCode), PHONE, PIN, freshIp());
    expect(result.employee.id).toBe(employeeId);
    expect(verifyEmployeePortalToken(result.accessToken).tenantId).toBe(tenantId);
  }, 30_000);

  it("still logs in with the legacy tenant id that installed apps have saved", async () => {
    const result = await employeePortalLogin(tenantId, PHONE, PIN, freshIp());
    expect(result.employee.id).toBe(employeeId);
  }, 30_000);

  it("answers an unknown code, an oversized code, a wrong tenant and a wrong PIN identically", async () => {
    const ip = freshIp();
    const errors = await Promise.all([
      failure(employeePortalLogin("9999999", PHONE, PIN, ip)),
      failure(employeePortalLogin("99999999999999", PHONE, PIN, ip)),
      failure(employeePortalLogin(otherTenantId, PHONE, PIN, ip)),
      failure(employeePortalLogin(String(tenantCode), "0500000000", PIN, ip)),
    ]);
    for (const e of errors) {
      expect(e.status).toBe(401);
      expect(e.message).toBe(INVALID_LOGIN_MESSAGE);
    }
  }, 60_000);

  it("locks after 5 wrong PINs, and a locked account answers exactly like a wrong PIN — even with the correct PIN", async () => {
    const ip = freshIp();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      const e = await failure(employeePortalLogin(String(tenantCode), PHONE, "000000", ip));
      expect([e.status, e.message]).toEqual([401, INVALID_LOGIN_MESSAGE]);
    }
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(row.portalLockoutCount).toBe(1);
    expect(row.portalLockedUntil!.getTime() - Date.now()).toBeGreaterThan(BASE_LOCK_MS - 60_000);

    const lockedWithCorrectPin = await failure(employeePortalLogin(String(tenantCode), PHONE, PIN, ip));
    expect([lockedWithCorrectPin.status, lockedWithCorrectPin.message]).toEqual([401, INVALID_LOGIN_MESSAGE]);
  }, 60_000);

  it("does not reset the counter when a lock expires: one more wrong PIN relocks, for twice as long", async () => {
    await prisma.employee.update({
      where: { id: employeeId },
      data: { failedPortalLoginAttempts: MAX_FAILED_ATTEMPTS, portalLockoutCount: 1, portalLockedUntil: new Date(Date.now() - 1000) },
    });
    await failure(employeePortalLogin(String(tenantCode), PHONE, "000000", freshIp()));
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(row.failedPortalLoginAttempts).toBe(MAX_FAILED_ATTEMPTS + 1);
    expect(row.portalLockoutCount).toBe(2);
    const remaining = row.portalLockedUntil!.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(2 * BASE_LOCK_MS - 60_000);
    expect(remaining).toBeLessThanOrEqual(2 * BASE_LOCK_MS);
  }, 30_000);

  it("clears every lockout counter after a successful login", async () => {
    await prisma.employee.update({
      where: { id: employeeId },
      data: { failedPortalLoginAttempts: 7, portalLockoutCount: 3, portalLockedUntil: new Date(Date.now() - 1000) },
    });
    await employeePortalLogin(String(tenantCode), PHONE, PIN, freshIp());
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect([row.failedPortalLoginAttempts, row.portalLockoutCount, row.portalLockedUntil]).toEqual([0, 0, null]);
  }, 30_000);

  it("progressive lock durations: 15m, 30m, 1h ... capped at 24h", () => {
    expect([1, 2, 3, 4].map(lockDurationMs)).toEqual([15, 30, 60, 120].map((m) => m * 60_000));
    expect(lockDurationMs(40)).toBe(24 * 60 * 60_000);
  });

  it("throttles an IP after too many failures (429), even with correct credentials; other IPs are unaffected", async () => {
    const ip = freshIp();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) {
      // رموز منشآت غير موجودة: فشل يُحسَب على الـ IP دون أن يقفل حساب الموظف الحقيقي.
      await failure(employeePortalLogin(String(8_000_000 + i), PHONE, PIN, ip));
    }
    const throttled = await failure(employeePortalLogin(String(tenantCode), PHONE, PIN, ip));
    expect(throttled.status).toBe(429);
    const elsewhere = await employeePortalLogin(String(tenantCode), PHONE, PIN, freshIp());
    expect(elsewhere.employee.id).toBe(employeeId);
  }, 120_000);

  it("refuses a suspended tenant at login — but only reveals the suspension to valid credentials", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { subscriptionStatus: "suspended", suspensionReason: "نزاع سداد" } });
    const valid = await failure(employeePortalLogin(String(tenantCode), PHONE, PIN, freshIp()));
    expect(valid.status).toBe(401);
    expect(valid.message).toContain("نزاع سداد");
    const invalid = await failure(employeePortalLogin(String(tenantCode), PHONE, "000000", freshIp()));
    expect(invalid.message).toBe(INVALID_LOGIN_MESSAGE);
  }, 30_000);

  it("the portal middleware rejects an already-issued token once the tenant is suspended", async () => {
    const token = signEmployeePortalToken({ employeeId, tenantId });
    const run = async () => {
      const req: any = { headers: { authorization: `Bearer ${token}` } };
      let passed = false;
      await authenticateEmployeePortal(req, {} as any, () => { passed = true; });
      return { passed, req };
    };
    const ok = await run();
    expect(ok.passed).toBe(true);
    expect(ok.req.employeeAuth.employeeId).toBe(employeeId);

    await prisma.tenant.update({ where: { id: tenantId }, data: { subscriptionStatus: "suspended" } });
    await expect(run()).rejects.toMatchObject({ status: 401 });
  });

  it("never returns the PIN hash by default — directly or through a nested include — only when explicitly requested", async () => {
    const plain = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(plain).not.toHaveProperty("pinHash");
    const nested = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { employees: true } });
    expect(nested.employees[0]).not.toHaveProperty("pinHash");
    const explicit = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, omit: { pinHash: false } });
    expect(explicit.pinHash).toMatch(/^\$2[aby]\$/);
    const selected = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { pinHash: true } });
    expect(selected.pinHash).toMatch(/^\$2[aby]\$/);
  });
});
