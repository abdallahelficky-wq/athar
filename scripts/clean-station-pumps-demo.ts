/**
 * إزالة بالضبط ما ينشئه scripts/seed-station-pumps-demo.ts — لا أكثر: فوهات المضخات 2-6،
 * قراءاتها، ووردية "البذرة" الحاملة لهذه القراءات (معرّفها ثابت، راجع
 * scripts/lib/stationPumpsSeedSpec.ts). المضخة 1 وفوهاتها وكل تاريخها الحقيقي (كل ورديات
 * حقيقية أخرى وقراءاتها) لا تُلمَس إطلاقاً مهما حدث.
 *
 * قائمة المضخات/الفوهات المُراد حذفها مُستوردة من نفس scripts/lib/stationPumpsSeedSpec.ts الذي
 * يستورده سكريبت البذرة نفسه — يستحيل بنيوياً أن تنحرف هذه القائمة عن قائمة ما زُرع فعلاً.
 *
 * أمان الحذف: تُحذَف وردية البذرة أولاً (بمعرّفها الثابت) — هذا يحذف تلقائياً (onDelete: Cascade)
 * كل قراءاتها فقط، بما فيها قراءة فوهتَي المضخة 1 على وردية البذرة تحديداً (سطر بيانات صناعي بحت
 * لتمرير القراءة الحقيقية فقط، لا تاريخاً حقيقياً بحد ذاته) — لا تُمسّ أي وردية حقيقية أخرى بتاتاً.
 * بعدها تُحذَف فوهات المضخات 2-6 نفسها — فوهة واحدة فقط تُحذَف لو لم يعد لها أي قراءة متبقية؛ لو
 * استُخدمت فوهة منها فعلياً في وردية حقيقية لاحقة (العامل جرَّب الشاشة بها فعلاً) تبقى قراءاتها
 * الحقيقية تلك عائقاً طبيعياً أمام حذف الفوهة (قيد مفتاح أجنبي)، فيتخطّاها هذا السكريبت بتحذير
 * وضوح بدل حذف تلك القراءات الحقيقية بصمت — "يزيل ما زرعه هو فقط، لا شيئاً آخر" حرفياً.
 *
 * رافض للتشغيل من الأساس ما لم يكن DATABASE_URL يشير بوضوح لقاعدة تطوير محلية — راجع
 * scripts/lib/assertLocalDevDatabase.ts لتفاصيل هذا الفحص وطريقة تجاوزه عمداً عند الحاجة.
 *
 * قابل لإعادة التشغيل بأمان: تشغيله على بيانات نُظِّفت بالفعل (أو لم تُزرَع أصلاً) لا يفعل شيئاً
 * ولا يفشل.
 *
 * الاستخدام:
 *   npm run seed:station-pumps:clean
 *   (أو: npx tsx scripts/clean-station-pumps-demo.ts <companyId> لتنظيف شركة أخرى غير الشركة
 *   التجريبية الافتراضية أدناه)
 */
import { PrismaClient } from "@prisma/client";
import { assertLocalDevDatabase, positionalArgs } from "./lib/assertLocalDevDatabase";
import { NEW_NOZZLES, seedShiftId as seedShiftIdFor } from "./lib/stationPumpsSeedSpec";

assertLocalDevDatabase();

const prisma = new PrismaClient();

const DEFAULT_DEMO_COMPANY_ID = "cmu18xy9a00042gfgoelchbwo";

async function main() {
  const companyId = positionalArgs()[0] || DEFAULT_DEMO_COMPANY_ID;

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);

  // نفس اشتقاق "المحطة الحالية" في سكريبت البذرة تماماً — من فوهة المضخة 1 الموجودة، لا معرّف
  // CostCenter منفصل.
  const existingPumpOneNozzle = await prisma.stationNozzle.findFirst({
    where: { companyId, pumpNumber: 1 },
  });
  if (!existingPumpOneNozzle) {
    console.log(`لا توجد فوهة للمضخة 1 تحت الشركة ${companyId} أصلاً — لا شيء لتنظيفه.`);
    return;
  }
  const costCenterId = existingPumpOneNozzle.costCenterId;
  const seedShiftId = seedShiftIdFor(costCenterId);

  const deletedShift = await prisma.stationShift.deleteMany({ where: { id: seedShiftId } });
  console.log(
    deletedShift.count > 0
      ? `تم حذف وردية البذرة (${seedShiftId}) وكل قراءاتها المرتبطة بها تحديداً.`
      : "وردية البذرة غير موجودة أصلاً (رُبما نُظِّفت من قبل).",
  );

  let removedNozzles = 0;
  let skippedNozzles = 0;
  for (const spec of NEW_NOZZLES) {
    const nozzle = await prisma.stationNozzle.findUnique({
      where: { costCenterId_pumpNumber_nozzleNumber: { costCenterId, pumpNumber: spec.pumpNumber, nozzleNumber: spec.nozzleNumber } },
    });
    if (!nozzle) continue; // غير موجودة أصلاً — نُظِّفت من قبل أو لم تُزرَع بعد

    const remainingReadings = await prisma.stationShiftReading.count({ where: { nozzleId: nozzle.id } });
    if (remainingReadings > 0) {
      skippedNozzles += 1;
      console.warn(
        `تخطّي حذف فوهة المضخة ${spec.pumpNumber} رقم ${spec.nozzleNumber} — لها ${remainingReadings} قراءة حقيقية متبقية ` +
          "(استُخدمت فعلياً في وردية حقيقية بعد الزرع)، فلا تُحذَف تلك البيانات الحقيقية بصمت.",
      );
      continue;
    }
    await prisma.stationNozzle.delete({ where: { id: nozzle.id } });
    removedNozzles += 1;
  }

  console.log(`تم حذف ${removedNozzles} فوهة من فوهات المضخات 2-6 الاصطناعية.`);
  if (skippedNozzles > 0) {
    console.log(`تخطّي ${skippedNozzles} فوهة لوجود بيانات حقيقية عليها — راجع التحذيرات أعلاه.`);
  }
  console.log("\nالمضخة 1 وفوهاتها وكل تاريخها الحقيقي بقيت كما هي بلا أي تعديل.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
