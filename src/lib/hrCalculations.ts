/**
 * دوال الحساب الخاصة بشئون الموظفين — منقولة حرفياً من AtharAlMuhasabi.jsx
 * (serviceDuration, calcEOS, dailyRate, daysInMonth, accruedLeaveDays, computeWidePayrollRow)
 * لضمان تطابق الأرقام رقماً برقم مع البروتوتايب المرجعي، كما يوصي القسم 7 من المستند.
 */

export interface ServiceDuration {
  years: number;
  months: number;
  days: number;
  totalYears: number;
}

export function serviceDuration(start: Date, end: Date): ServiceDuration {
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(end.getFullYear(), end.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const totalYears = years + months / 12 + days / 365;
  return { years, months, days, totalYears: Math.max(totalYears, 0) };
}

export type TerminationReason = "resign" | "employer" | "contractEnd";

export interface EosResult {
  wage: number;
  totalYears: number;
  fullReward: number;
  ratio: number;
  ratioNote: string;
  finalAmount: number;
}

/** مكافأة نهاية الخدمة وفق المادتين 84 و85 من نظام العمل السعودي — حساب تقديري توضيحي */
export function calcEOS(
  employee: { basicSalary: number; housingAllowance: number; hireDate: Date },
  endDate: Date,
  reason: TerminationReason,
): EosResult {
  const wage = employee.basicSalary + employee.housingAllowance;
  const { totalYears } = serviceDuration(employee.hireDate, endDate);
  const first5 = Math.min(totalYears, 5);
  const remaining = Math.max(totalYears - 5, 0);
  const fullReward = first5 * 0.5 * wage + remaining * 1 * wage;

  let ratio = 1;
  let ratioNote = "استحقاق كامل";
  if (reason === "resign") {
    if (totalYears < 2) {
      ratio = 0;
      ratioNote = "أقل من سنتين خدمة — لا يستحق مكافأة";
    } else if (totalYears < 5) {
      ratio = 1 / 3;
      ratioNote = "استقالة بين 2 و5 سنوات — يستحق ثلث المكافأة";
    } else if (totalYears < 10) {
      ratio = 2 / 3;
      ratioNote = "استقالة بين 5 و10 سنوات — يستحق ثلثي المكافأة";
    } else {
      ratio = 1;
      ratioNote = "استقالة بعد 10 سنوات فأكثر — استحقاق كامل";
    }
  }

  return { wage, totalYears, fullReward, ratio, ratioNote, finalAmount: fullReward * ratio };
}

export interface EmployeePayBase {
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
}

export function dailyRate(emp: EmployeePayBase): number {
  return (emp.basicSalary + emp.housingAllowance + emp.transportAllowance + (emp.otherAllowance || 0)) / 30;
}

export function daysInMonth(monthStr: string): number {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export interface AccruedLeave {
  refDate: Date;
  annualEntitlement: number;
  days: number;
}

/** رصيد إجازة سنوية متراكم منذ آخر عودة من إجازة (أو تاريخ المباشرة) — نظام العمل السعودي، المادة 109 */
export function accruedLeaveDays(
  emp: { hireDate: Date; lastLeaveReturnDate: Date | null },
  uptoDate: Date,
): AccruedLeave {
  const refDate = emp.lastLeaveReturnDate || emp.hireDate;
  const { totalYears } = serviceDuration(emp.hireDate, uptoDate);
  const annualEntitlement = totalYears >= 5 ? 30 : 21;
  const daysSinceRef = Math.max((uptoDate.getTime() - refDate.getTime()) / 86_400_000, 0);
  return { refDate, annualEntitlement, days: (daysSinceRef / 365) * annualEntitlement };
}

export interface HrActionSummary {
  absenceDays: number;
  overtime: number;
  otherAdd: number;
  advance: number;
  violation: number;
  penalty: number;
  otherDed: number;
}

export function summarizeActions(actions: { actionType: string; value: number }[]): HrActionSummary {
  const s: HrActionSummary = { absenceDays: 0, overtime: 0, otherAdd: 0, advance: 0, violation: 0, penalty: 0, otherDed: 0 };
  actions.forEach((a) => {
    const v = Number(a.value || 0);
    if (a.actionType === "absence") s.absenceDays += v;
    else if (a.actionType === "overtime") s.overtime += v;
    else if (a.actionType === "bonus" || a.actionType === "other_addition") s.otherAdd += v;
    else if (a.actionType === "advance") s.advance += v;
    else if (a.actionType === "violation") s.violation += v;
    else if (a.actionType === "penalty") s.penalty += v;
    else if (a.actionType === "other_deduction") s.otherDed += v;
  });
  return s;
}

export interface WidePayrollRow {
  basic: number;
  housing: number;
  transport: number;
  otherAllow: number;
  otherAdd: number;
  overtime: number;
  totalAdditions: number;
  grossTotal: number;
  gosi: number;
  absence: number;
  advance: number;
  violation: number;
  penalty: number;
  otherDed: number;
  totalDeductions: number;
  net: number;
  note: string;
}

export interface WidePayrollEmployee {
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  gosiAmount: number | null;
  gosiApplicable: boolean;
  advances: number;
  otherDeductions: number;
}

const blankRow: WidePayrollRow = {
  basic: 0, housing: 0, transport: 0, otherAllow: 0, otherAdd: 0, overtime: 0,
  totalAdditions: 0, grossTotal: 0, gosi: 0, absence: 0, advance: 0, violation: 0,
  penalty: 0, otherDed: 0, totalDeductions: 0, net: 0, note: "",
};

/** محرك الرواتب الموسّع: يدمج بيانات الموظف الثابتة مع إجراءات الشهر — مطابق لـ computeWidePayrollRow */
export function computeWidePayrollRow(
  emp: WidePayrollEmployee,
  month: string,
  onLeaveThisMonth: boolean,
  returningThisMonth: { returnDate: Date } | null,
  actions: { actionType: string; value: number }[],
): WidePayrollRow {
  if (onLeaveThisMonth) {
    return { ...blankRow, note: "الموظف في إجازة — تمت تسوية مستحقاته بشكل منفصل" };
  }

  const a = summarizeActions(actions);
  let basic = emp.basicSalary, housing = emp.housingAllowance, transport = emp.transportAllowance, otherAllow = emp.otherAllowance || 0;
  let note = "";

  if (returningThisMonth) {
    const dim = daysInMonth(month);
    const returnDay = returningThisMonth.returnDate.getDate();
    const workedDays = Math.max(dim - returnDay + 1, 0);
    const factor = workedDays / dim;
    basic *= factor; housing *= factor; transport *= factor; otherAllow *= factor;
    note = `مباشرة بعد إجازة — ${workedDays} يوم من ${returningThisMonth.returnDate.toISOString().slice(0, 10)}`;
  }

  const overtime = a.overtime;
  const otherAdd = a.otherAdd;
  const totalAdditions = housing + transport + otherAllow + otherAdd + overtime;
  const grossTotal = basic + totalAdditions;

  const gosi = emp.gosiAmount != null && emp.gosiAmount > 0
    ? emp.gosiAmount
    : (emp.gosiApplicable ? Math.round((emp.basicSalary + emp.housingAllowance) * 0.0975) : 0);
  const absence = a.absenceDays * dailyRate(emp);
  const advance = (emp.advances || 0) + a.advance;
  const violation = a.violation;
  const penalty = a.penalty;
  const otherDed = (emp.otherDeductions || 0) + a.otherDed;
  const totalDeductions = gosi + absence + advance + violation + penalty + otherDed;
  const net = grossTotal - totalDeductions;

  return { basic, housing, transport, otherAllow, otherAdd, overtime, totalAdditions, grossTotal, gosi, absence, advance, violation, penalty, otherDed, totalDeductions, net, note };
}

export const PAYROLL_ROW_FIELDS = [
  "basic", "housing", "transport", "otherAllow", "otherAdd", "overtime",
  "gosi", "absence", "advance", "violation", "penalty", "otherDed",
] as const;

export function applyRowOverride(row: WidePayrollRow, override: Partial<WidePayrollRow>): WidePayrollRow {
  const merged = { ...row, ...override };
  merged.totalAdditions = merged.housing + merged.transport + merged.otherAllow + merged.otherAdd + merged.overtime;
  merged.grossTotal = merged.basic + merged.totalAdditions;
  merged.totalDeductions = merged.gosi + merged.absence + merged.advance + merged.violation + merged.penalty + merged.otherDed;
  merged.net = merged.grossTotal - merged.totalDeductions;
  return merged;
}

/** خريطة توزيع بنود كشف الرواتب على شجرة الحسابات — مطابقة حرفياً للقسم 4.8 من المستند */
export const PAYROLL_JOURNAL_MAP: [keyof WidePayrollRow, string, "debit" | "credit"][] = [
  ["basic", "مصروف رواتب أساسية", "debit"],
  ["housing", "مصروف بدل سكن", "debit"],
  ["transport", "مصروف بدل مواصلات", "debit"],
  ["otherAllow", "مصروف بدلات أخرى", "debit"],
  ["otherAdd", "مصروف إضافات وحوافز أخرى", "debit"],
  ["overtime", "مصروف بدل إضافي (عمل إضافي)", "debit"],
  ["gosi", "التأمينات الاجتماعية - مستحقة", "credit"],
  ["advance", "سلف الموظفين", "credit"],
  ["violation", "صندوق العاملين - مخالفات وعقوبات", "credit"],
  ["penalty", "صندوق العاملين - مخالفات وعقوبات", "credit"],
  ["otherDed", "استقطاعات أخرى مستحقة", "credit"],
];
