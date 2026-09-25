/**
 * التعريف المشترك الوحيد لما يزرعه scripts/seed-station-pumps-demo.ts وما يزيله بالضبط
 * scripts/clean-station-pumps-demo.ts — سكريبتا البذرة والتنظيف يستوردان من هنا حصراً بدل تكرار
 * قائمة المضخات/الفوهات في كل منهما، حتى يستحيل أن ينحرف أحدهما عن الآخر لاحقاً (تنظيف يحذف أقل أو
 * أكثر مما زرعته البذرة فعلاً).
 */
import type { StationFuelProduct } from "@prisma/client";

export interface NewNozzleSpec {
  pumpNumber: number;
  nozzleNumber: number;
  product: StationFuelProduct;
  /** قراءة "أخيرة" معقولة غير صفرية لهذه الفوهة الجديدة — لا تاريخ حقيقي سابق لها لتُشتَق منه. */
  seedReading: number;
}

export const NEW_NOZZLES: NewNozzleSpec[] = [
  { pumpNumber: 2, nozzleNumber: 1, product: "gasoline_91", seedReading: 48210 },
  { pumpNumber: 2, nozzleNumber: 2, product: "gasoline_95", seedReading: 52340 },
  { pumpNumber: 3, nozzleNumber: 1, product: "gasoline_91", seedReading: 31875 },
  { pumpNumber: 3, nozzleNumber: 2, product: "gasoline_95", seedReading: 40120 },
  { pumpNumber: 4, nozzleNumber: 1, product: "diesel", seedReading: 67450 },
  { pumpNumber: 4, nozzleNumber: 2, product: "diesel", seedReading: 71200 },
  { pumpNumber: 5, nozzleNumber: 1, product: "diesel", seedReading: 28900 },
  { pumpNumber: 5, nozzleNumber: 2, product: "diesel", seedReading: 33150 },
  // مضخة 6: فوهة واحدة فقط عمداً — للتحقق أن الشاشة لا تفترض دائماً فوهتين لكل مضخة.
  { pumpNumber: 6, nozzleNumber: 1, product: "gasoline_91", seedReading: 15600 },
];

/** معرّف ثابت (لا cuid عشوائي) لوردية "البذرة" — واحد بالضبط لكل محطة، يبقى نفسه عبر كل مرات
 * التشغيل، ويستخدمه سكريبت التنظيف للعثور عليها وحذفها بدقة بلا أي تخمين. */
export function seedShiftId(costCenterId: string): string {
  return `seed-station-pumps-demo-${costCenterId}`;
}
