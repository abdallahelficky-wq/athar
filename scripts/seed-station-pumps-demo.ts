/**
 * سكريبت إعداد بيانات تجريبية محلية فقط — يضيف 5 مضخات إضافية (2 حتى 6) لمحطة الوقود التجريبية
 * الموجودة أصلاً، فوق المضخة 1 الحالية (فوهتان)، حتى تظهر شاشة العامل الجديدة (المُجمَّعة حسب
 * المضخة، راجع StationShiftScreen.jsx) بتخطيطها الحقيقي مع عدد مضخات واقعي — لا يمسّ المضخة 1
 * ولا فوهاتها إطلاقاً.
 *
 * **لا تُشغِّل هذا السكريبت أبداً على DATABASE_URL لقاعدة بيانات إنتاجية** — يكتب مباشرة لقاعدة
 * البيانات المُعرَّفة في DATABASE_URL الحالي بلا أي حماية dry-run، بنفس تحذير
 * scripts/seed-station-shift-demo.ts (المرجع الذي بُني عليه هذا السكريبت).
 *
 * يفترض وجود مضخة 1 بفوهة واحدة على الأقل بالفعل تحت الشركة المطلوبة (نفس "المحطة" — CostCenter —
 * تُشتَق تلقائياً من فوهات المضخة 1 الموجودة، لا تُمرَّر كمعرّف منفصل)، تماماً كحال بيانات الاختبار
 * الحالية المذكورة في طلب التشغيل.
 *
 * القراءة "الافتتاحية/الأخيرة" التي يعتمد عليها حساب الوردية التالية ليست حقلاً على الفوهة نفسها
 * إطلاقاً (ولا تُعرَض حالياً في أي شاشة) — تُشتَق دائماً من قراءة إغلاق آخر وردية سابقة لنفس
 * المحطة ككل (getPreviousClosingReadings في stationShifts.service.ts تختار وردية واحدة فقط، الأحدث
 * تاريخاً لكل المحطة، وتقرأ قراءات فوهاتها). لإعطاء الفوهات الجديدة قيمة غير صفرية واقعية دون
 * اختراع تاريخ محاسبي مزيَّف، ينشئ هذا السكريبت وردية "بذرة" واحدة بمعرّف ثابت (id صريح، لا
 * cuid عشوائي) — فتبقى نفس الصف عبر كل مرات التشغيل بدل تكرارها — بتاريخ يُحسَب دائماً كيوم واحد
 * بعد أحدث وردية حقيقية موجودة فعلاً لهذه المحطة (أو 2020-01-01 لو لم توجد أي وردية بعد)، لضمان
 * أنها هي "الأحدث" فتُختار فعلياً عند فتح الوردية الحقيقية التالية. بحالة "posted" بلا قيد محاسبي
 * (journalEntryId يبقى فارغاً عمداً) — غير مقصودة لتمثيل محاسبة حقيقية، ولا تظهر في قائمة "قيد
 * المراجعة" ولا أي شاشة أخرى يستخدمها المحاسب أو العامل، ويتوقف اعتمادها تلقائياً بمجرد وجود
 * وردية حقيقية أحدث منها (تصبح هي "الأحدث" حينها، والبذرة تُستبعَد بلا أي تدخل إضافي).
 *
 * isSeedData=true (لا معرّفها الثابت ولا تاريخها) هي العلامة الفعلية التي تستبعدها من كل تقارير
 * ورديات المحطات (stationShiftsReports) — تلك الحقول الأخرى تخدم فقط آلية اشتقاق القراءة
 * الافتتاحية أعلاه، ولا صلة لها بمنطق استبعاد التقارير إطلاقاً.
 *
 * تحمل وردية البذرة قراءة واحدة لكل فوهة في المحطة بأكملها — فوهتا المضخة 1 القديمتين أيضاً، لكن
 * بقيمتيهما الحقيقيتين المُشتقّتين من آخر وردية فعلية سبق وجودها (تُحدَّث في كل تشغيل لتبقى مطابقة
 * لأحدث رقم حقيقي)، أو بقيمة بذرة معقولة لو لم توجد أي وردية حقيقية بعد — لا يُخترَع رقم جديد لهما
 * بصرف النظر عما إذا كان لهما تاريخ حقيقي بالفعل.
 *
 * قابل لإعادة التشغيل بأمان بالكامل: كل مضخة/فوهة تُنشأ عبر upsert على مفتاحها الفريد الفعلي في
 * المخطط (costCenterId+pumpNumber+nozzleNumber)، ووردية البذرة عبر upsert على معرّفها الثابت،
 * وقراءاتها عبر upsert على (shiftId+nozzleId) — إعادة التشغيل لا تُكرِّر مضخة/فوهة/وردية واحدة.
 *
 * رافض للتشغيل من الأساس ما لم يكن DATABASE_URL يشير بوضوح لقاعدة تطوير محلية — راجع
 * scripts/lib/assertLocalDevDatabase.ts لتفاصيل هذا الفحص وطريقة تجاوزه عمداً عند الحاجة.
 *
 * الاستخدام:
 *   npm run seed:station-pumps
 *   (أو: npx tsx scripts/seed-station-pumps-demo.ts <companyId> لتشغيله على شركة أخرى غير الشركة
 *   التجريبية الافتراضية المذكورة أدناه)
 *
 * التنظيف: scripts/clean-station-pumps-demo.ts يزيل بالضبط ما ينشئه هذا السكريبت (لا أكثر) —
 * كلاهما يستوردان تعريف المضخات/الفوهات من scripts/lib/stationPumpsSeedSpec.ts نفسه، فلا يمكن
 * لأحدهما أن ينحرف عن الآخر.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { assertLocalDevDatabase, positionalArgs } from "./lib/assertLocalDevDatabase";
import { NEW_NOZZLES, seedShiftId as seedShiftIdFor, type NewNozzleSpec } from "./lib/stationPumpsSeedSpec";

assertLocalDevDatabase();

const prisma = new PrismaClient();

const DEFAULT_DEMO_COMPANY_ID = "cmu18xy9a00042gfgoelchbwo";
const SEED_SHIFT_TYPE = "night" as const;
const FALLBACK_SEED_DATE = new Date(Date.UTC(2020, 0, 1));
const PUMP_ONE_FALLBACK_READING = 12000;

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function main() {
  const companyId = positionalArgs()[0] || DEFAULT_DEMO_COMPANY_ID;

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);
  if (company.businessActivity !== "fuel_stations") {
    throw new Error(`نشاط الشركة الحالي "${company.businessActivity}" وليس "fuel_stations" — تأكد من معرّف الشركة الصحيح.`);
  }
  const tenantId = company.tenantId;

  // "المحطة الحالية" تُشتَق من فوهة المضخة 1 الموجودة فعلاً — لا معرّف CostCenter منفصل يُطلَب من
  // المستخدم، تماماً كما وُصف الطلب ("أضف للمحطة التجريبية الحالية").
  const existingPumpOneNozzle = await prisma.stationNozzle.findFirst({
    where: { companyId, pumpNumber: 1 },
    orderBy: { nozzleNumber: "asc" },
  });
  if (!existingPumpOneNozzle) {
    throw new Error(
      `لا توجد أي فوهة للمضخة 1 تحت الشركة ${companyId} — هذا السكريبت يضيف فقط للمحطة الموجودة أصلاً، لا ينشئ محطة من الصفر.`,
    );
  }
  const costCenterId = existingPumpOneNozzle.costCenterId;
  const { meterDigits, meterType, hasMoneyMeter } = existingPumpOneNozzle;
  const seedShiftId = seedShiftIdFor(costCenterId);

  console.log(`المحطة (CostCenter): ${costCenterId}`);
  console.log(`قالب الفوهة المُستنسَخ عن المضخة 1: meterDigits=${meterDigits} meterType=${meterType} hasMoneyMeter=${hasMoneyMeter}`);

  // أنشئ/أعد استخدام فوهات المضخات 2-6 — نفس مواصفات عداد المضخة 1 (رقمياً/نوعاً)، بلا لمس أي
  // فوهة موجودة أصلاً (upsert لا يُحدِّث شيئاً في "update" لو الفوهة موجودة، فقط يضمن وجودها).
  const createdNozzles: { spec: NewNozzleSpec; id: string }[] = [];
  for (const spec of NEW_NOZZLES) {
    const nozzle = await prisma.stationNozzle.upsert({
      where: { costCenterId_pumpNumber_nozzleNumber: { costCenterId, pumpNumber: spec.pumpNumber, nozzleNumber: spec.nozzleNumber } },
      update: {},
      create: {
        tenantId,
        companyId,
        costCenterId,
        product: spec.product,
        pumpNumber: spec.pumpNumber,
        nozzleNumber: spec.nozzleNumber,
        meterDigits,
        meterType,
        hasMoneyMeter,
      },
    });
    createdNozzles.push({ spec, id: nozzle.id });
  }
  console.log(`تم التأكد من وجود ${NEW_NOZZLES.length} فوهة عبر 5 مضخات جديدة (2-6).`);

  // موظف تُنسَب له وردية البذرة — يُفضَّل موظف هذه المحطة تحديداً، وإلا أي موظف بنفس المستأجر.
  // الوردية غير مقصودة لتمثيل عمل هذا الموظف فعلياً، فقط لتثبيت قراءة إغلاق سابقة للفوهات.
  const seedEmployee =
    (await prisma.employee.findFirst({ where: { tenantId, assignedCostCenterId: costCenterId } })) ??
    (await prisma.employee.findFirst({ where: { tenantId } }));
  if (!seedEmployee) {
    console.warn(
      "تحذير: لا يوجد أي موظف (Employee) بهذا المستأجر بعد — تم إنشاء المضخات/الفوهات، لكن تعذّر إنشاء وردية البذرة " +
        "لإعطائها قراءة افتتاحية غير صفرية (تحتاج موظفاً لتُنسَب له). أنشئ موظفاً وأعد تشغيل السكريبت لإكمال هذه الخطوة.",
    );
    console.log("انتهى السكريبت (المضخات/الفوهات فقط، بلا قراءات بذرة).");
    return;
  }

  // أحدث وردية حقيقية موجودة فعلاً لهذه المحطة (باستثناء وردية البذرة نفسها بمعرّفها الثابت) —
  // وردية البذرة تُوضَع دائماً بعدها بيوم واحد بالضبط، لتبقى هي "الأحدث" فعلياً وتُختار عند حساب
  // القراءة الافتتاحية للوردية الحقيقية التالية، دون أي تخمين لتاريخ "اليوم".
  const latestRealShift = await prisma.stationShift.findFirst({
    where: { tenantId, costCenterId, id: { not: seedShiftId } },
    orderBy: [{ shiftDate: "desc" }, { createdAt: "desc" }],
    include: { readings: true },
  });
  const seedShiftDate = latestRealShift ? addUtcDays(latestRealShift.shiftDate, 1) : FALLBACK_SEED_DATE;

  const realClosingByNozzle = new Map<string, Prisma.Decimal>();
  for (const reading of latestRealShift?.readings ?? []) {
    const value = reading.accountantConfirmedValue ?? reading.closingReading;
    if (value != null) realClosingByNozzle.set(reading.nozzleId, new Prisma.Decimal(value));
  }

  const seedShift = await prisma.stationShift.upsert({
    where: { id: seedShiftId },
    update: { shiftDate: seedShiftDate, shiftType: SEED_SHIFT_TYPE, employeeId: seedEmployee.id, isSeedData: true },
    create: {
      id: seedShiftId,
      tenantId,
      companyId,
      costCenterId,
      employeeId: seedEmployee.id,
      shiftDate: seedShiftDate,
      shiftType: SEED_SHIFT_TYPE,
      openedAt: seedShiftDate,
      closedAt: seedShiftDate,
      status: "posted",
      // العلامة الفعلية التي تستبعد هذه الوردية من كل تقارير stationShiftsReports — راجع تعليق
      // الحقل في schema.prisma؛ لا علاقة لمعرّفها الثابت أو تاريخها بهذا الاستبعاد إطلاقاً.
      isSeedData: true,
    },
  });

  // فوهتا المضخة 1 (وأي فوهة أخرى قد تكون أُضيفت لها لاحقاً): قيمتهما الحقيقية إن وُجدت — تُحدَّث
  // في كل تشغيل لتبقى مطابقة لأحدث رقم حقيقي — وإلا قيمة بذرة معقولة (نفس معاملة الفوهات الجديدة).
  const pumpOneNozzles = await prisma.stationNozzle.findMany({ where: { costCenterId, pumpNumber: 1 } });
  for (const nozzle of pumpOneNozzles) {
    const value = realClosingByNozzle.get(nozzle.id)?.toNumber() ?? PUMP_ONE_FALLBACK_READING;
    await prisma.stationShiftReading.upsert({
      where: { shiftId_nozzleId: { shiftId: seedShift.id, nozzleId: nozzle.id } },
      update: { openingReading: Math.max(0, value - 500), accountantConfirmedValue: value, capturedAt: seedShiftDate },
      create: {
        tenantId,
        companyId,
        shiftId: seedShift.id,
        nozzleId: nozzle.id,
        openingReading: Math.max(0, value - 500),
        testLiters: 0,
        accountantConfirmedValue: value,
        capturedAt: seedShiftDate,
      },
    });
  }

  // الفوهات الجديدة (مضخات 2-6): قيم البذرة المحدَّدة في NEW_NOZZLES أعلاه — ثابتة عبر كل تشغيل.
  for (const { spec, id: nozzleId } of createdNozzles) {
    await prisma.stationShiftReading.upsert({
      where: { shiftId_nozzleId: { shiftId: seedShift.id, nozzleId } },
      update: {},
      create: {
        tenantId,
        companyId,
        shiftId: seedShift.id,
        nozzleId,
        openingReading: Math.max(0, spec.seedReading - 500),
        testLiters: 0,
        accountantConfirmedValue: spec.seedReading,
        capturedAt: seedShiftDate,
      },
    });
  }

  console.log(
    `تم ضبط قراءة "أخيرة" غير صفرية لكل فوهات المحطة (${pumpOneNozzles.length + createdNozzles.length} فوهة) عبر وردية بذرة واحدة ` +
      `(${seedShift.id}، بتاريخ ${seedShiftDate.toISOString().slice(0, 10)}).`,
  );
  console.log("\nتم الإعداد بنجاح — افتح شاشة العامل (بوابة الموظف) لمعاينة المضخات 1-6.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
