import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { dailyRate, daysInMonth } from "../../lib/hrCalculations";
import { computeEmployeePayroll, PayrollSettingsLike } from "../../lib/payrollEngine";
import { LEGACY_ACTION_TYPE_TO_KEY } from "../../lib/legacyPayrollComponents";
import { resolveEffectiveComponents } from "../payrollRuns/payrollRuns.service";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { createJournalEntryTx } from "../../lib/journalPosting";

interface CreateInput {
  employeeId: string;
  leaveStartDate: Date;
  leaveEndDate?: Date | null;
  settlementType: "actual_leave" | "cash_in_service";
  cashLeaveDays?: number;
  bonuses: number;
  deductions: number;
  ticketAmount: number;
  visaAmount: number;
}

function salaryBasis(emp: ReturnType<typeof empPayBase>, basis: string) {
  if (basis === "basic") return emp.basicSalary;
  if (basis === "basic_housing") return emp.basicSalary + emp.housingAllowance;
  return emp.basicSalary + emp.housingAllowance + emp.transportAllowance + emp.otherAllowance;
}

async function calculatePreview(tenantId: string, emp: any, leaveStartDate: Date, options: { leaveEndDate: Date | null; settlementType: "actual_leave" | "cash_in_service"; cashLeaveDays: number }) {
  const settings: any = await prisma.payrollSettings.findUnique({ where: { companyId: emp.companyId } });
  const beforeFive = Number(settings?.leaveDaysBeforeFive ?? 21), afterFive = Number(settings?.leaveDaysAfterFive ?? 30);
  const divisor = Number(settings?.leaveDailyRateDivisor ?? 30), basis = settings?.leaveSalaryBasis ?? "total";
  const serviceDays = Math.max((leaveStartDate.getTime() - emp.hireDate.getTime()) / 86_400_000, 0);
  const firstFiveDays = Math.min(serviceDays, 5 * 365), laterDays = Math.max(serviceDays - 5 * 365, 0);
  const accruedDays = (firstFiveDays / 365) * beforeFive + (laterDays / 365) * afterFive;
  const used: any = await (prisma.leaveSettlement as any).aggregate({ where: { employeeId: emp.id }, _sum: { leaveDays: true } });
  const usedDays = Number(used._sum.leaveDays ?? 0), availableDays = Math.max(accruedDays - usedDays, 0);
  const requestedDays = options.settlementType === "cash_in_service"
    ? Math.max(options.cashLeaveDays || 0, 0)
    : options.leaveEndDate ? Math.max(Math.floor((options.leaveEndDate.getTime() - leaveStartDate.getTime()) / 86_400_000) + 1, 0) : 0;
  const leaveDays = Math.min(requestedDays, availableDays);
  const pay = empPayBase(emp), leaveDaily = salaryBasis(pay, basis) / divisor;
  const daysWorked = Math.max(leaveStartDate.getDate() - 1, 0);
  const payrollMonth = leaveStartDate.toISOString().slice(0, 7);
  const payrollSettings: PayrollSettingsLike = {
    standardHoursPerMonth: Number(settings?.standardHoursPerMonth ?? 240),
    standardDaysPerMonth: Number(settings?.standardDaysPerMonth ?? 30),
  };
  const { components, persisted } = await resolveEffectiveComponents(tenantId, emp.companyId);
  const [assignments, actions] = await Promise.all([
    persisted ? prisma.employeePayrollComponent.findMany({ where: { employeeId: emp.id, isActive: true } }) : Promise.resolve([]),
    prisma.hrAction.findMany({ where: { employeeId: emp.id, month: payrollMonth }, orderBy: { createdAt: "asc" } }),
  ]);
  const assignedIds = new Set(assignments.map((a) => a.componentId));
  const employeeComponents = persisted ? components.filter((c) => assignedIds.has(c.id)) : components;
  const fixedValues = new Map<string, number>();
  if (persisted) assignments.forEach((a) => { if (a.fixedValue != null) fixedValues.set(a.componentId, Number(a.fixedValue)); });
  else {
    if (Number(emp.advances)) fixedValues.set("legacy:advance", Number(emp.advances));
    if (Number(emp.otherDeductions)) fixedValues.set("legacy:otherDed", Number(emp.otherDeductions));
    if (emp.gosiAmount != null) fixedValues.set("legacy:gosi", Number(emp.gosiAmount));
  }
  const monthlyAdjustments = new Map<string, number>();
  actions.forEach((action) => {
    const id = action.componentId || (LEGACY_ACTION_TYPE_TO_KEY[action.actionType] ? `legacy:${LEGACY_ACTION_TYPE_TO_KEY[action.actionType]}` : null);
    if (id) monthlyAdjustments.set(id, (monthlyAdjustments.get(id) || 0) + Number(action.value));
  });
  const payroll = computeEmployeePayroll({ employee: pay, components: employeeComponents, fixedValues, monthlyAdjustments,
    settings: payrollSettings, fullyOnLeave: false, prorationFactor: Math.min(daysWorked / payrollSettings.standardDaysPerMonth, 1) });
  const componentLines = employeeComponents.map((component) => ({ id: component.id, name: component.name, kind: component.kind,
    amount: payroll.values.get(component.id) || 0, hasProcedure: monthlyAdjustments.has(component.id) })).filter((line) => line.amount !== 0 || line.hasProcedure);
  return { daysWorked, daily: salaryBasis(pay, "total") / payrollSettings.standardDaysPerMonth, monthAmount: payroll.net,
    salary: { additions: payroll.totalAdditions, deductions: payroll.totalDeductions, net: payroll.net, components: componentLines, procedureCount: actions.length },
    accrual: { days: accruedDays, usedDays, availableDays, amount: availableDays * leaveDaily },
    leaveDays, leaveDaily, leavePayAmount: leaveDays * leaveDaily, settings: { beforeFive, afterFive, divisor, basis } };
}

function empPayBase(emp: { basicSalary: unknown; housingAllowance: unknown; transportAllowance: unknown; otherAllowance: unknown }) {
  return {
    basicSalary: Number(emp.basicSalary),
    housingAllowance: Number(emp.housingAllowance),
    transportAllowance: Number(emp.transportAllowance),
    otherAllowance: Number(emp.otherAllowance),
  };
}

export async function listLeaveSettlements(tenantId: string, filters: { companyId?: string; employeeId?: string }) {
  return prisma.leaveSettlement.findMany({
    where: {
      tenantId,
      employeeId: filters.employeeId || undefined,
      employee: filters.companyId ? { companyId: filters.companyId } : undefined,
    },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function previewLeaveSettlement(tenantId: string, employeeId: string, leaveStartDate: Date, options: { leaveEndDate: Date | null; settlementType: "actual_leave" | "cash_in_service"; cashLeaveDays: number } = { leaveEndDate: null, settlementType: "actual_leave", cashLeaveDays: 0 }) {
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!emp) throw notFound("الموظف غير موجود");
  if (emp.leaveStatus === "onLeave") throw badRequest("الموظف في إجازة بالفعل");

  return calculatePreview(tenantId, emp, leaveStartDate, options);
}

export async function createLeaveSettlement(tenantId: string, userId: string, input: CreateInput) {
  const emp = await prisma.employee.findFirst({ where: { id: input.employeeId, tenantId } });
  if (!emp) throw notFound("الموظف غير موجود");
  if (emp.leaveStatus === "onLeave") throw badRequest("الموظف في إجازة بالفعل");

  const preview = await calculatePreview(tenantId, emp, input.leaveStartDate, { leaveEndDate: input.leaveEndDate ?? null, settlementType: input.settlementType, cashLeaveDays: input.cashLeaveDays ?? 0 });
  if (preview.leaveDays <= 0) throw badRequest("حدد مدة الإجازة أو عدد أيام البدل المطلوب صرفها");
  const { daysWorked, monthAmount } = preview;
  const net = monthAmount + preview.leavePayAmount + input.bonuses - input.deductions + input.ticketAmount + input.visaAmount;
  if (net <= 0) throw badRequest("صافي المبلغ المستحق يجب أن يكون أكبر من صفر");

  const salaryPortion = monthAmount + preview.leavePayAmount + input.bonuses - input.deductions;
  const ticketVisaPortion = input.ticketAmount + input.visaAmount;

  const payableAccountId = await resolvePartyAccountId(tenantId, emp.companyId, emp, "ذمم الموظفين - مستحقات وإجازات");
  const lines: { accountId: string; department: string; debit: number; credit: number; employeeId: string }[] = [];
  if (salaryPortion !== 0) {
    const salaryAccountId = await getAccountIdByName(tenantId, emp.companyId, "مصروف رواتب");
    lines.push({ accountId: salaryAccountId, department: "المالية والحسابات", debit: Math.max(salaryPortion, 0), credit: 0, employeeId: emp.id });
  }
  if (ticketVisaPortion > 0) {
    const ticketAccountId = await getAccountIdByName(tenantId, emp.companyId, "مصروف تذاكر وتأشيرات الموظفين");
    lines.push({ accountId: ticketAccountId, department: "الموارد البشرية", debit: ticketVisaPortion, credit: 0, employeeId: emp.id });
  }
  lines.push({ accountId: payableAccountId, department: "المالية والحسابات", debit: 0, credit: net, employeeId: emp.id });

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: emp.companyId,
      date: input.leaveStartDate,
      memo: `مستحقات إجازة — ${emp.name}`,
      sourceModule: "leave_settlement",
      createdBy: userId,
      lines,
    });

    const settlement = await tx.leaveSettlement.create({
      data: {
        tenantId,
        employeeId: emp.id,
        leaveStartDate: input.leaveStartDate,
        leaveEndDate: input.leaveEndDate,
        settlementType: input.settlementType,
        leaveDays: preview.leaveDays,
        usedLeaveDaysBefore: preview.accrual.usedDays,
        remainingLeaveDays: preview.accrual.availableDays - preview.leaveDays,
        leaveBalanceAmount: preview.accrual.amount,
        leavePayAmount: preview.leavePayAmount,
        monthAmount,
        daysWorked,
        bonuses: input.bonuses,
        deductions: input.deductions,
        ticketAmount: input.ticketAmount,
        visaAmount: input.visaAmount,
        accruedDays: preview.accrual.days,
        netAmount: net,
        journalEntryId: entry.id,
        status: "calculated",
      } as any,
      include: { employee: true },
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: settlement.id } });
    if (input.settlementType === "actual_leave") await tx.employee.update({ where: { id: emp.id }, data: { leaveStatus: "onLeave" } });
    return settlement;
  });
}

export async function disburseLeaveSettlement(tenantId: string, userId: string, id: string, method: "cash" | "bank", date: Date) {
  const settlement = await prisma.leaveSettlement.findFirst({ where: { id, tenantId }, include: { employee: true } });
  if (!settlement) throw notFound("تسوية الإجازة غير موجودة");
  if (settlement.status === "disbursed") throw badRequest("تم صرف هذه التسوية مسبقاً");

  const payableAccountId = await resolvePartyAccountId(tenantId, settlement.employee.companyId, settlement.employee, "ذمم الموظفين - مستحقات وإجازات");
  const creditAccountId = await getAccountIdByName(tenantId, settlement.employee.companyId, method === "cash" ? "النقدية بالصندوق" : "البنك الأهلي - حساب تشغيلي");
  const amount = Number(settlement.netAmount);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: settlement.employee.companyId,
      date,
      memo: `صرف مستحقات إجازة — ${settlement.employee.name}`,
      sourceModule: "leave_settlement",
      sourceId: settlement.id,
      createdBy: userId,
      lines: [
        { accountId: payableAccountId, department: "المالية والحسابات", debit: amount, credit: 0, employeeId: settlement.employeeId },
        { accountId: creditAccountId, department: "المالية والحسابات", debit: 0, credit: amount, employeeId: settlement.employeeId },
      ],
    });

    return tx.leaveSettlement.update({
      where: { id },
      data: { status: "disbursed", disbursementMethod: method, disbursementDate: date, disbursementJournalEntryId: entry.id },
      include: { employee: true },
    });
  });
}

export async function registerLeaveReturn(tenantId: string, employeeId: string, returnDate: Date) {
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!emp) throw notFound("الموظف غير موجود");
  if (emp.leaveStatus !== "onLeave") throw badRequest("الموظف ليس في إجازة حالياً");

  const openSettlement = await prisma.leaveSettlement.findFirst({ where: { employeeId, returnDate: null } });
  if (!openSettlement) throw badRequest("لا توجد تسوية إجازة مفتوحة لهذا الموظف");

  const month = returnDate.toISOString().slice(0, 7);
  const dim = daysInMonth(month);
  const workedDays = Math.max(dim - returnDate.getDate() + 1, 0);
  const previewAmount = dailyRate(empPayBase(emp)) * workedDays;

  const [, settlement] = await prisma.$transaction([
    prisma.employee.update({ where: { id: employeeId }, data: { leaveStatus: "active", lastLeaveReturnDate: returnDate } }),
    prisma.leaveSettlement.update({ where: { id: openSettlement.id }, data: { returnDate } }),
  ]);

  return { settlement, preview: { month, workedDays, amount: previewAmount } };
}

