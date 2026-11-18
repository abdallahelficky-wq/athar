import { fromHalalas, toHalalas, vatInGrossHalalas } from "./money";

/**
 * حسابات موديول الإيجارات الخالصة (بلا قاعدة بيانات): فصل الضريبة من مبلغ الدفعة، توليد تواريخ الاستحقاق من شروط العقد،
 * وتوزيع صافي الدفعة على أشهر فترتها (الإطفاء). كل التواريخ أيام تقويمية بصيغة YYYY-MM-DD، والمبالغ تُحسَب بالهللات.
 */

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_ONLY = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isDateOnly = (v: string) => DATE_ONLY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`));
export const isMonthOnly = (v: string) => MONTH_ONLY.test(v);
export const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const dateToDay = (date: Date) => date.toISOString().slice(0, 10);

function parts(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/** يضيف أشهراً ليوم تقويمي مع تثبيت اليوم على آخر يوم في الشهر الناتج إن تجاوزه (31 يناير + شهر = 28/29 فبراير). */
export function addMonths(day: string, months: number): string {
  const { y, m, d } = parts(day);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function addDays(day: string, days: number): string {
  return dateToDay(new Date(dayToDate(day).getTime() + days * DAY_MS));
}

export interface VatSplit {
  amount: number;
  vatAmount: number;
  netAmount: number;
}

/** مبلغ الدفعة الإجمالي ← صافٍ وضريبة: العقد الشامل تُستخرج ضريبته من الإجمالي (المبلغ × النسبة ÷ (100 + النسبة))، وغير الشامل بلا ضريبة. */
export function splitLeaseVat(grossAmount: number, vatMode: "none" | "inclusive", ratePercent: number): VatSplit {
  const gross = toHalalas(grossAmount);
  const vat = vatMode === "inclusive" && ratePercent > 0 ? vatInGrossHalalas(gross, ratePercent) : 0;
  return { amount: fromHalalas(gross), vatAmount: fromHalalas(vat), netAmount: fromHalalas(gross - vat) };
}

export interface ScheduledInstallment {
  dueDate: string;
  periodFrom: string;
  periodTo: string;
}

/**
 * دفعات عقد من أول استحقاق كل everyMonths شهراً حتى until (شاملاً): كل دفعة تغطي من تاريخ استحقاقها حتى اليوم السابق
 * للاستحقاق التالي. الاستحقاقات تُحسَب كلها من أول استحقاق (لا من السابق) فلا ينجرف اليوم بعد شهر قصير.
 */
export function generateInstallments(firstDueDate: string, everyMonths: number, until: string): ScheduledInstallment[] {
  if (!isDateOnly(firstDueDate) || !isDateOnly(until)) throw new Error("invalid date");
  if (!Number.isInteger(everyMonths) || everyMonths < 1 || everyMonths > 120) throw new Error("invalid interval");
  const out: ScheduledInstallment[] = [];
  for (let i = 0; i < 600; i += 1) {
    const dueDate = addMonths(firstDueDate, i * everyMonths);
    if (dueDate > until) break;
    out.push({ dueDate, periodFrom: dueDate, periodTo: addDays(addMonths(firstDueDate, (i + 1) * everyMonths), -1) });
  }
  return out;
}

/** أشهر الفترة (YYYY-MM) من شهر بدايتها إلى شهر نهايتها، مع وزن كل شهر. */
function periodMonths(periodFrom: string, periodTo: string): { month: string; weight: number }[] {
  if (!isDateOnly(periodFrom) || !isDateOnly(periodTo) || periodFrom > periodTo) throw new Error("invalid period");
  const from = parts(periodFrom);
  const to = parts(periodTo);
  // فترة أشهر كاملة (من أول يوم في شهر إلى آخر يوم في شهر): أقساط شهرية متساوية كما يقيّدها المحاسب.
  // غير ذلك (تبدأ أو تنتهي وسط الشهر): كل شهر بعدد أيامه المغطّاة.
  const wholeMonths = from.d === 1 && to.d === daysInMonth(to.y, to.m);
  const months: { month: string; weight: number }[] = [];
  for (let index = from.y * 12 + from.m - 1; index <= to.y * 12 + to.m - 1; index += 1) {
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const first = index === from.y * 12 + from.m - 1 ? from.d : 1;
    const last = index === to.y * 12 + to.m - 1 ? to.d : daysInMonth(y, m);
    months.push({ month: `${y}-${pad(m)}`, weight: wholeMonths ? 1 : last - first + 1 });
  }
  return months;
}

/**
 * توزيع صافي الدفعة على أشهر فترتها بالهللات: نصيب كل شهر فرق التراكمي المقرَّب لأسفل قبله وبعده (فتتوزع كسور الهللة على
 * الأشهر)، وتراكمي آخر شهر هو الصافي نفسه — فمجموع الأقساط يساوي الصافي تماماً.
 */
export function amortizationPlan(netAmount: number, periodFrom: string, periodTo: string): { month: string; amount: number }[] {
  const months = periodMonths(periodFrom, periodTo);
  const net = toHalalas(netAmount);
  const totalWeight = months.reduce((s, m) => s + m.weight, 0);
  let cumulativeWeight = 0;
  let allocated = 0;
  return months.map((m, i) => {
    cumulativeWeight += m.weight;
    const cumulative = i === months.length - 1 ? net : Math.floor((net * cumulativeWeight) / totalWeight);
    const amount = cumulative - allocated;
    allocated = cumulative;
    return { month: m.month, amount: fromHalalas(amount) };
  });
}

/** ما يجب أن يكون قد أُطفئ من الدفعة حتى نهاية شهر معيّن (شاملاً) — يلحق تلقائياً بأي شهر فات إطفاؤه. */
export function amortizedThrough(netAmount: number, periodFrom: string, periodTo: string, month: string): number {
  if (!isMonthOnly(month)) throw new Error("invalid month");
  const halalas = amortizationPlan(netAmount, periodFrom, periodTo)
    .filter((m) => m.month <= month)
    .reduce((s, m) => s + toHalalas(m.amount), 0);
  return fromHalalas(halalas);
}

/** آخر يوم في شهر YYYY-MM (تاريخ قيد الإطفاء). */
export function monthEndDay(month: string): string {
  if (!isMonthOnly(month)) throw new Error("invalid month");
  const [y, m] = month.split("-").map(Number);
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}
