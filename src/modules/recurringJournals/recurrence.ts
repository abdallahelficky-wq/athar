/**
 * حساب مواعيد القيود الدورية — دوال نقية على تواريخ UTC بمنتصف الليل (تاريخ يوم فقط).
 * dayOfMonth: 1..28، أو 31 = آخر يوم في الشهر (28/29/30/31 حسب الشهر).
 * المواعيد تُعَدّ من شهر تاريخ البداية بخطوة 1/3/6/12 شهراً؛ أول موعد هو أول موعد ≥ تاريخ البداية.
 */
export type Frequency = "monthly" | "quarterly" | "semiannual" | "yearly";

export const STEP_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };
export const LAST_DAY = 31;

const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** موعد الشهر رقم k (0 = شهر البداية) */
export function occurrence(startDate: Date, frequency: Frequency, dayOfMonth: number, k: number): Date {
  const monthIndex = startDate.getUTCMonth() + k * STEP_MONTHS[frequency];
  const y = startDate.getUTCFullYear() + Math.floor(monthIndex / 12);
  const m0 = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(dayOfMonth >= LAST_DAY ? 31 : dayOfMonth, daysInMonth(y, m0));
  return new Date(Date.UTC(y, m0, day));
}

/** أول موعد ≥ notBefore (وليس قبل البداية)، أو null لو تجاوز endDate */
export function nextOccurrence(
  schedule: { startDate: Date; endDate?: Date | null; frequency: Frequency; dayOfMonth: number },
  notBefore: Date,
): Date | null {
  const floor = dateOnly(notBefore) > dateOnly(schedule.startDate) ? dateOnly(notBefore) : dateOnly(schedule.startDate);
  for (let k = 0; k < 2400; k++) {
    const d = occurrence(dateOnly(schedule.startDate), schedule.frequency, schedule.dayOfMonth, k);
    if (d >= floor) {
      if (schedule.endDate && d > dateOnly(schedule.endDate)) return null;
      return d;
    }
  }
  return null;
}

/** الموعد بعد موعد معيّن */
export function followingOccurrence(
  schedule: { startDate: Date; endDate?: Date | null; frequency: Frequency; dayOfMonth: number },
  after: Date,
): Date | null {
  return nextOccurrence(schedule, new Date(dateOnly(after).getTime() + 86_400_000));
}

/** «اليوم» بتوقيت السعودية (UTC+3 ثابت) كتاريخ يوم */
export function todayKsa(now: Date = new Date()): Date {
  return dateOnly(new Date(now.getTime() + 3 * 3_600_000));
}
