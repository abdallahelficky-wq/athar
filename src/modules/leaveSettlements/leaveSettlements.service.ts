import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { dailyRate, accruedLeaveDays, daysInMonth } from "../../lib/hrCalculations";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx } from "../../lib/journalPosting";

interface CreateInput {
  employeeId: string;
  leaveStartDate: Date;
  bonuses: number;
  deductions: number;
  ticketAmount: number;
  visaAmount: number;
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

export async function previewLeaveSettlement(tenantId: string, employeeId: string, leaveStartDate: Date) {
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!emp) throw notFound("الموظف غير موجود");
  if (emp.leaveStatus === "onLeave") throw badRequest("الموظف في إجازة بالفعل");

  const daysWorked = leaveStartDate.getDate();
  const daily = dailyRate(empPayBase(emp));
  const monthAmount = daily * daysWorked;
  const accrual = accruedLeaveDays({ hireDate: emp.hireDate, lastLeaveReturnDate: emp.lastLeaveReturnDate }, leaveStartDate);
  return { daysWorked, daily, monthAmount, accrual };
}

export async function createLeaveSettlement(tenantId: string, userId: string, input: CreateInput) {
  const emp = await prisma.employee.findFirst({ where: { id: input.employeeId, tenantId } });
  if (!emp) throw notFound("الموظف غير موجود");
  if (emp.leaveStatus === "onLeave") throw badRequest("الموظف في إجازة بالفعل");

  const daysWorked = input.leaveStartDate.getDate();
  const daily = dailyRate(empPayBase(emp));
  const monthAmount = daily * daysWorked;
  const net = monthAmount + input.bonuses - input.deductions + input.ticketAmount + input.visaAmount;
  if (net <= 0) throw badRequest("صافي المبلغ المستحق يجب أن يكون أكبر من صفر");

  const accrual = accruedLeaveDays({ hireDate: emp.hireDate, lastLeaveReturnDate: emp.lastLeaveReturnDate }, input.leaveStartDate);

  const salaryPortion = monthAmount + input.bonuses - input.deductions;
  const ticketVisaPortion = input.ticketAmount + input.visaAmount;

  const payableAccountId = await getAccountIdByName(tenantId, emp.companyId, "ذمم الموظفين - مستحقات وإجازات");
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
        monthAmount,
        daysWorked,
        bonuses: input.bonuses,
        deductions: input.deductions,
        ticketAmount: input.ticketAmount,
        visaAmount: input.visaAmount,
        accruedDays: accrual.days,
        netAmount: net,
        journalEntryId: entry.id,
        status: "calculated",
      },
      include: { employee: true },
    });

    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: settlement.id } });
    await tx.employee.update({ where: { id: emp.id }, data: { leaveStatus: "onLeave" } });
    return settlement;
  });
}

export async function disburseLeaveSettlement(tenantId: string, userId: string, id: string, method: "cash" | "bank", date: Date) {
  const settlement = await prisma.leaveSettlement.findFirst({ where: { id, tenantId }, include: { employee: true } });
  if (!settlement) throw notFound("تسوية الإجازة غير موجودة");
  if (settlement.status === "disbursed") throw badRequest("تم صرف هذه التسوية مسبقاً");

  const payableAccountId = await getAccountIdByName(tenantId, settlement.employee.companyId, "ذمم الموظفين - مستحقات وإجازات");
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
