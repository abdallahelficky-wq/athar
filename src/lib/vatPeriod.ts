import { prisma } from "./prisma";
import { badRequest, notFound } from "./httpError";
import { riyadhCalendarDay, riyadhDayEndExclusiveUtc, riyadhDayStartUtc } from "./riyadhDate";

/**
 * فترة إقرار ضريبة القيمة المضافة لشركة واحدة. كل تقارير الضريبة (ملخص المبيعات، ملخص المشتريات،
 * المطابقة) تشترط الشركة والفترة صراحةً: لا مجموع على كل الشركات ولا مجموع على عمر الشركة كله،
 * لأن الإقرار يُقدَّم لكل رقم ضريبي عن فترة محددة، وأي رقم بلا فترة لا يصلح للتوقيع عليه.
 *
 * الحدود بتوقيت الرياض (نفس riyadhDate.ts): من بداية يوم `from` حتى نهاية يوم `to` شاملاً، حتى تقع
 * فاتورة نقطة البيع المسجَّلة الساعة 01:00 فجر أول الشهر في شهرها الصحيح لا في الشهر السابق.
 */
export interface VatPeriod {
  companyId: string;
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string) {
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export async function parseVatPeriod(tenantId: string, query: Record<string, unknown>): Promise<VatPeriod> {
  const companyId = typeof query.companyId === "string" ? query.companyId : "";
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  if (!companyId) throw badRequest("تقارير الضريبة تتطلب تحديد الشركة");
  if (!from || !to) throw badRequest("تقارير الضريبة تتطلب فترة الإقرار (من، إلى)");
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to) || !isRealDate(from) || !isRealDate(to)) {
    throw badRequest("تاريخ الفترة غير صالح (الصيغة المطلوبة YYYY-MM-DD)");
  }
  if (from > to) throw badRequest("بداية الفترة بعد نهايتها");
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  return { companyId, from, to, start: riyadhDayStartUtc(from), endExclusive: riyadhDayEndExclusiveUtc(to) };
}

/**
 * آخر فترة إقرار مكتملة قبل اليوم (بتوقيت الرياض): الشهر السابق للشهري، والربع التقويمي السابق
 * للربعي (نفس أرباع تنبيه موعد الإقرار في الداشبورد: تنتهي في مارس ويونيو وسبتمبر وديسمبر).
 */
export function lastCompleteFilingPeriod(frequency: "monthly" | "quarterly", today: Date = new Date()) {
  const [y, m] = riyadhCalendarDay(today).split("-").map(Number);
  const monthsBack = frequency === "monthly" ? 1 : ((m - 1) % 3) + 3;
  const startIndex = y * 12 + (m - 1) - monthsBack;
  const span = frequency === "monthly" ? 1 : 3;
  const startY = Math.floor(startIndex / 12);
  const startM = (startIndex % 12) + 1;
  const endIndex = startIndex + span - 1;
  const endY = Math.floor(endIndex / 12);
  const endM = (endIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(endY, endM, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${startY}-${pad(startM)}-01`, to: `${endY}-${pad(endM)}-${pad(lastDay)}` };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
