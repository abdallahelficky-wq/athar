/**
 * حدود السنة المالية لشركة من شهر بدايتها (Company.fiscalYearStartMonth، 1 = يناير). التواريخ كلها
 * منتصف ليل UTC لليوم التقويمي، بنفس اصطلاح تواريخ القيود في النظام. تنتهي السنة في آخر يوم من الشهر
 * السابق لشهر البداية (بداية أبريل ⇐ نهاية 31 مارس من السنة التالية).
 */
export interface FiscalYearBounds {
  start: Date;
  end: Date;
  /** نهاية اليوم الأخير (شاملة) — حدّ الاستعلام عن قيود السنة */
  endInclusive: Date;
  label: string;
}

export function normalizeStartMonth(month: number | null | undefined): number {
  return Number.isInteger(month) && (month as number) >= 1 && (month as number) <= 12 ? (month as number) : 1;
}

/** السنة المالية التي تبدأ في سنة `startYear` الميلادية. */
export function fiscalYearStartingIn(startYear: number, startMonth: number): FiscalYearBounds {
  const m = normalizeStartMonth(startMonth);
  const start = new Date(Date.UTC(startYear, m - 1, 1));
  const end = new Date(Date.UTC(startYear + 1, m - 1, 0));
  const endInclusive = new Date(end.getTime() + 86_400_000 - 1);
  const label = m === 1 ? String(startYear) : `${startYear}/${startYear + 1}`;
  return { start, end, endInclusive, label };
}

/** السنة المالية التي يقع فيها التاريخ (باليوم التقويمي UTC). */
export function fiscalYearContaining(date: Date, startMonth: number): FiscalYearBounds {
  const m = normalizeStartMonth(startMonth);
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() + 1 >= m ? y : y - 1;
  return fiscalYearStartingIn(startYear, m);
}

/** اليوم الحالي بتوقيت السعودية كتاريخ منتصف ليل UTC. */
export function todayRiyadh(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { calendar: "gregory", timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}
