import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { requireActionPermission } from "../../middleware/auth";
import { register } from "./auth.service";

/**
 * مستأجر "محطات وقود" جديد من شاشة التسجيل يجب أن يكون جاهزاً لورديات المحطات بلا أي إعداد يدوي:
 * شركته بنشاط fuel_stations (ما يقرأه إظهار الموديول في الواجهة)، حسابا عجز/زيادة نقد الورديات مربوطان
 * (كان التسجيل يتخطّاهما فيفشل ترحيل أي وردية)، ومالكه يجتاز صلاحيتي مراجعة الورديات وترحيلها.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const email = `fuel-owner-${Date.now()}@example.com`;
let tenantId = "";

describe("registering a fuel-station tenant (integration)", () => {
  afterAll(async () => {
    if (!tenantId) return;
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerId: null } });
    // حذف المستأجر يتسلسل (cascade) لبياناته الابتدائية؛ الهوية مشتركة بين المستأجرين فتُحذَف منفصلة
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await prisma.identity.deleteMany({ where: { email } });
  });

  it("links the station cash shortage/surplus accounts and lets the owner review and post shifts", async () => {
    const result = await register({ tenantName: "محطات اختبار", businessActivity: "fuel_stations", name: "مالك", email, password: "Str0ng-Pass!" });
    tenantId = result.tenant.id;

    const company = await prisma.company.findFirstOrThrow({
      where: { tenantId },
      select: {
        businessActivity: true,
        stationCashShortageAccount: { select: { code: true } },
        stationCashSurplusAccount: { select: { code: true } },
      },
    });
    expect(company.businessActivity).toBe("fuel_stations");
    expect(company.stationCashShortageAccount?.code).toBe("622005");
    expect(company.stationCashSurplusAccount?.code).toBe("431003");

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.enabledModules).toEqual([]);

    const owner = await prisma.user.findFirstOrThrow({ where: { tenantId } });
    expect(tenant.ownerId).toBe(owner.id);
    for (const action of ["review", "post"]) {
      let passed = false;
      const req: any = { auth: { sub: owner.id, tenantId, role: owner.role } };
      await requireActionPermission("stationShifts", action, "approve")(req, {} as any, () => { passed = true; });
      expect(passed).toBe(true);
    }
  }, 60_000);
});
