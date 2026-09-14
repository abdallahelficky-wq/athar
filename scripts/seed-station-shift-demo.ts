/**
 * سكريبت إعداد بيانات تجريبية محلية فقط — لتجربة تدفّق ورديات المحطة (فرع feature/station-shifts)
 * فعلياً عبر شاشة الاختبار المؤقتة (frontend/src/wired/StationShiftsTestPanel.jsx، المسار
 * /station-shifts-test)، على قاعدة بيانات تطوير/اختبار محلية فقط.
 *
 * **لا تُشغِّل هذا السكريبت أبداً على DATABASE_URL لقاعدة بيانات حقيقية/إنتاجية** — يكتب مباشرة
 * لقاعدة البيانات بلا أي حماية dry-run، بعكس سكريبتات الإنتاج الأخرى في هذا المستودع، لأنه مخصَّص
 * حصراً لقاعدة تطوير محلية فارغة/تجريبية يملكها المستخدم نفسه.
 *
 * يفترض أن الشركة (companyId) أُنشئت بالفعل عبر شاشة "إضافة شركة" الطبيعية في التطبيق، بنشاط
 * "محطات وقود" (fuel_stations) — هذا يُنشئ تلقائياً شجرة الحسابات المتخصصة وحسابي عجز/زيادة
 * الصندوق على الشركة (createCompany في companies.controller.ts)، فلا يعيد هذا السكريبت أياً من
 * ذلك. يضيف فقط ما لا شاشة له بعد في التطبيق: محطة (CostCenter) وفوهتين (StationNozzle) وسعرين
 * ساريين (FuelPrice)، بالإضافة إلى مستخدمَي اختبار (عامل ومحاسب) بمنصبين منفصلين تماماً — يوضّح
 * هذا الفصل فعلياً صلاحية "اعتماد" (review) المنفصلة عن "ترحيل" (post) موضوع الإصلاح الخامس.
 *
 * قابل لإعادة التشغيل بأمان: يتحقق من وجود كل عنصر (بالاسم/البريد) قبل إنشائه، فلا يُكرِّر شيئاً
 * لو شُغِّل أكثر من مرة على نفس الشركة.
 *
 * الاستخدام:
 *   DATABASE_URL=<رابط قاعدة بيانات محلية/تطوير فقط> npx tsx scripts/seed-station-shift-demo.ts <companyId>
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const WORKER_EMAIL = "station-worker-test@local.test";
const ACCOUNTANT_EMAIL = "station-accountant-test@local.test";
const TEST_PASSWORD = "Test@1234";
const COST_CENTER_NAME = "محطة اختبار 1";

async function ensureIdentityAndUser(
  tenantId: string,
  companyId: string,
  email: string,
  name: string,
  passwordHash: string,
  extra: { positionId: string; assignedCostCenterId?: string },
) {
  const identity = await prisma.identity.upsert({
    where: { email },
    create: { email, passwordHash },
    update: { passwordHash },
  });
  const existingUser = await prisma.user.findFirst({ where: { identityId: identity.id, tenantId } });
  if (existingUser) return existingUser;
  return prisma.user.create({
    data: {
      identityId: identity.id,
      tenantId,
      name,
      role: "viewer", // الدور العام لا يؤثر على صلاحيات stationShifts — فقط المنصب (Position) يفعل
      companyScope: companyId,
      positionId: extra.positionId,
      assignedCostCenterId: extra.assignedCostCenterId,
    },
  });
}

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    console.error("الاستخدام: npx tsx scripts/seed-station-shift-demo.ts <companyId>");
    process.exit(1);
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);
  if (company.businessActivity !== "fuel_stations") {
    throw new Error(
      `نشاط الشركة الحالي "${company.businessActivity}" وليس "fuel_stations" — أنشئ شركة جديدة بهذا النشاط أولاً من شاشة "إضافة شركة" في التطبيق.`,
    );
  }
  if (!company.stationCashShortageAccountId || !company.stationCashSurplusAccountId) {
    console.warn("تحذير: حسابا عجز/زيادة الصندوق غير مضبوطين على هذه الشركة — راجع شاشة بيانات الشركة قبل تجربة الاعتماد/الترحيل.\n");
  }

  const tenantId = company.tenantId;

  let costCenter = await prisma.costCenter.findFirst({ where: { tenantId, companyId, name: COST_CENTER_NAME } });
  if (!costCenter) costCenter = await prisma.costCenter.create({ data: { tenantId, companyId, name: COST_CENTER_NAME } });

  let nozzleDiesel = await prisma.stationNozzle.findFirst({ where: { costCenterId: costCenter.id, product: "diesel" } });
  if (!nozzleDiesel) {
    nozzleDiesel = await prisma.stationNozzle.create({
      data: { tenantId, companyId, costCenterId: costCenter.id, product: "diesel", pumpNumber: 1, nozzleNumber: 1, meterDigits: 6, meterType: "electronic" },
    });
  }
  let nozzleGasoline95 = await prisma.stationNozzle.findFirst({ where: { costCenterId: costCenter.id, product: "gasoline_95" } });
  if (!nozzleGasoline95) {
    nozzleGasoline95 = await prisma.stationNozzle.create({
      data: { tenantId, companyId, costCenterId: costCenter.id, product: "gasoline_95", pumpNumber: 1, nozzleNumber: 2, meterDigits: 6, meterType: "electronic" },
    });
  }

  const existingPrices = await prisma.fuelPrice.findMany({ where: { tenantId, companyId, costCenterId: null } });
  const hasDieselPrice = existingPrices.some((p) => p.product === "diesel");
  const hasGasoline95Price = existingPrices.some((p) => p.product === "gasoline_95");
  const effectiveFrom = new Date();
  effectiveFrom.setUTCDate(effectiveFrom.getUTCDate() - 30);
  if (!hasDieselPrice) await prisma.fuelPrice.create({ data: { tenantId, companyId, product: "diesel", priceInclVat: 2.18, effectiveFrom } });
  if (!hasGasoline95Price) await prisma.fuelPrice.create({ data: { tenantId, companyId, product: "gasoline_95", priceInclVat: 2.33, effectiveFrom } });

  let workerPosition = await prisma.position.findFirst({ where: { tenantId, name: "عامل محطة (اختبار)" } });
  if (!workerPosition) {
    workerPosition = await prisma.position.create({
      data: { tenantId, name: "عامل محطة (اختبار)", actionPermissions: { create: [{ moduleId: "stationShifts", actionId: "worker", level: "edit" }] } },
    });
  }
  let accountantPosition = await prisma.position.findFirst({ where: { tenantId, name: "محاسب ورديات (اختبار)" } });
  if (!accountantPosition) {
    accountantPosition = await prisma.position.create({
      data: {
        tenantId,
        name: "محاسب ورديات (اختبار)",
        actionPermissions: {
          create: [
            { moduleId: "stationShifts", actionId: "review", level: "approve" },
            { moduleId: "stationShifts", actionId: "post", level: "approve" },
          ],
        },
      },
    });
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  await ensureIdentityAndUser(tenantId, companyId, WORKER_EMAIL, "عامل اختبار المحطة", passwordHash, {
    positionId: workerPosition.id,
    assignedCostCenterId: costCenter.id,
  });
  await ensureIdentityAndUser(tenantId, companyId, ACCOUNTANT_EMAIL, "محاسب اختبار الورديات", passwordHash, {
    positionId: accountantPosition.id,
  });

  console.log("تم الإعداد بنجاح.\n");
  console.log(`المحطة (CostCenter): ${costCenter.id}`);
  console.log(`الفوهات: ديزل=${nozzleDiesel.id}  بنزين 95=${nozzleGasoline95.id}`);
  console.log("\nبيانات الدخول للاختبار:");
  console.log(`  عامل المحطة    — البريد: ${WORKER_EMAIL}     — كلمة المرور: ${TEST_PASSWORD}`);
  console.log(`  محاسب الورديات — البريد: ${ACCOUNTANT_EMAIL} — كلمة المرور: ${TEST_PASSWORD}`);
  console.log("\nسجّل الدخول بحساب العامل أولاً، ثم افتح /station-shifts-test في المتصفح.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
