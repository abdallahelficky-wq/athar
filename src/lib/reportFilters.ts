import { badRequest } from "./httpError";
import { riyadhDayEndExclusiveUtc, riyadhDayStartUtc } from "./riyadhDate";

/**
 * فلتر تقارير المستندات (المبيعات، المشتريات، المخزون): شركة + فترة اختيارية بأيام كاملة بتوقيت الرياض —
 * نفس حدود تقارير الضريبة (vatPeriod.ts) حتى يتطابق الرقم بين التقريرين لنفس الفترة. بلا from/to = كل المدة
 * (السلوك السابق للتقارير قبل إضافة الفلتر، فلا يتغير أي رقم لمن لا يحدد فترة).
 */
export interface ReportFilters {
  companyId?: string;
  branchId?: string;
  start?: Date;
  endExclusive?: Date;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (v: string) => DAY.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;

export function parseReportFilters(query: Record<string, unknown>): ReportFilters {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const from = str(query.from);
  const to = str(query.to);
  if ((from && !realDay(from)) || (to && !realDay(to))) throw badRequest("صيغة التاريخ غير صحيحة — استخدم YYYY-MM-DD");
  if (from && to && from > to) throw badRequest("بداية الفترة بعد نهايتها");
  return {
    companyId: str(query.companyId),
    branchId: str(query.branchId),
    start: from ? riyadhDayStartUtc(from) : undefined,
    endExclusive: to ? riyadhDayEndExclusiveUtc(to) : undefined,
  };
}

/** شرط Prisma على حقل التاريخ للمستند؛ فارغ إن لم تُحدَّد فترة */
export function dateWhere(f: Pick<ReportFilters, "start" | "endExclusive">) {
  if (!f.start && !f.endExclusive) return {};
  return { date: { ...(f.start ? { gte: f.start } : {}), ...(f.endExclusive ? { lt: f.endExclusive } : {}) } };
}
