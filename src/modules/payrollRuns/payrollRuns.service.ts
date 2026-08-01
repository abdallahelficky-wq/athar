import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import {
  computeWidePayrollRow,
  applyRowOverride,
  PAYROLL_JOURNAL_MAP,
  WidePayrollRow,
} from "../../lib/hrCalculations";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("ar-SA", { year: "numeric", month: "long" });
}

export async function listPayrollRuns(tenantId: string, filters: { companyId?: string; month?: string }) {
  return prisma.payrollRun.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, month: filters.month || undefined },
    orderBy: { createdAt: "desc" },
  });
}

export async function createPayrollRun(tenantId: string, companyId: string, month: string, employeeIds: string[]) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");

  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds }, tenantId, companyId } });
  if (employees.length !== employeeIds.length) throw badRequest("أحد الموظفين المختارين غير موجود ضمن هذه الشركة");

  const existing = await prisma.payrollRun.findFirst({ where: { tenantId, companyId, month } });
  if (existing) throw badRequest(`يوجد كشف رواتب لشهر ${monthLabel(month)} لهذه الشركة بالفعل`);

  return prisma.payrollRun.create({
    data: { tenantId, companyId, month, employeeIds, status: "draft", overrides: {} },
  });
}

export async function updatePayrollRunEmployees(tenantId: string, id: string, employeeIds: string[]) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");
  if (run.status !== "draft") throw badRequest("لا يمكن تعديل كشف مرحّل، يجب فك ترحيله أولاً");

  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds }, tenantId, companyId: run.companyId } });
  if (employees.length !== employeeIds.length) throw badRequest("أحد الموظفين المختارين غير موجود ضمن هذه الشركة");

  return prisma.payrollRun.update({ where: { id }, data: { employeeIds } });
}

export async function setRowOverride(tenantId: string, id: string, employeeId: string, override: Partial<WidePayrollRow>) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");
  if (run.status !== "draft") throw badRequest("لا يمكن تعديل كشف مرحّل، يجب فك ترحيله أولاً");
  if (!run.employeeIds.includes(employeeId)) throw badRequest("هذا الموظف ليس ضمن كشف الرواتب");

  const overrides = { ...(run.overrides as Record<string, unknown>), [employeeId]: override };
  return prisma.payrollRun.update({ where: { id }, data: { overrides: overrides as Prisma.InputJsonValue } });
}

export async function clearRowOverride(tenantId: string, id: string, employeeId: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");
  if (run.status !== "draft") throw badRequest("لا يمكن تعديل كشف مرحّل، يجب فك ترحيله أولاً");

  const overrides = { ...(run.overrides as Record<string, unknown>) };
  delete overrides[employeeId];
  return prisma.payrollRun.update({ where: { id }, data: { overrides: overrides as Prisma.InputJsonValue } });
}

async function computeRunRows(tenantId: string, run: { companyId: string; month: string; employeeIds: string[]; overrides: unknown }) {
  const employees = await prisma.employee.findMany({ where: { id: { in: run.employeeIds }, tenantId } });
  const settlements = await prisma.leaveSettlement.findMany({ where: { employeeId: { in: run.employeeIds } } });
  const actions = await prisma.hrAction.findMany({ where: { employeeId: { in: run.employeeIds }, month: run.month } });
  const overridesMap = (run.overrides as Record<string, Partial<WidePayrollRow>>) || {};

  return run.employeeIds.map((employeeId) => {
    const emp = employees.find((e) => e.id === employeeId)!;
    const empSettlements = settlements.filter((s) => s.employeeId === employeeId);
    const onLeaveThisMonth = empSettlements.some((s) => s.leaveStartDate.toISOString().slice(0, 7) === run.month && !s.returnDate);
    const returning = empSettlements.find((s) => s.returnDate && s.returnDate.toISOString().slice(0, 7) === run.month);
    const empActions = actions.filter((a) => a.employeeId === employeeId).map((a) => ({ actionType: a.actionType, value: Number(a.value) }));

    let row = computeWidePayrollRow(
      {
        basicSalary: Number(emp.basicSalary),
        housingAllowance: Number(emp.housingAllowance),
        transportAllowance: Number(emp.transportAllowance),
        otherAllowance: Number(emp.otherAllowance),
        gosiAmount: emp.gosiAmount ? Number(emp.gosiAmount) : null,
        gosiApplicable: emp.gosiApplicable,
        advances: Number(emp.advances),
        otherDeductions: Number(emp.otherDeductions),
      },
      run.month,
      onLeaveThisMonth,
      returning ? { returnDate: returning.returnDate! } : null,
      empActions,
    );

    const override = overridesMap[employeeId];
    let overridden = false;
    if (override) {
      row = applyRowOverride(row, override);
      overridden = true;
    }

    return { employeeId, employeeName: emp.name, ...row, overridden };
  });
}

export async function getPayrollRunRows(tenantId: string, id: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");

  const rows = await computeRunRows(tenantId, run);
  const totals = rows.reduce(
    (s, r) => {
      s.basic += r.basic; s.housing += r.housing; s.transport += r.transport; s.otherAllow += r.otherAllow;
      s.otherAdd += r.otherAdd; s.overtime += r.overtime; s.totalAdditions += r.totalAdditions; s.grossTotal += r.grossTotal;
      s.gosi += r.gosi; s.absence += r.absence; s.advance += r.advance; s.violation += r.violation;
      s.penalty += r.penalty; s.otherDed += r.otherDed; s.totalDeductions += r.totalDeductions; s.net += r.net;
      return s;
    },
    { basic: 0, housing: 0, transport: 0, otherAllow: 0, otherAdd: 0, overtime: 0, totalAdditions: 0, grossTotal: 0, gosi: 0, absence: 0, advance: 0, violation: 0, penalty: 0, otherDed: 0, totalDeductions: 0, net: 0 },
  );

  return { run, rows, totals };
}

export async function postPayrollRun(tenantId: string, userId: string, id: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");
  if (run.status === "posted") throw badRequest("كشف الرواتب مرحّل بالفعل");

  const rows = await computeRunRows(tenantId, run);
  if (rows.length === 0) throw badRequest("لا يوجد موظفون في هذا الكشف");

  const byAccountName = new Map<string, number>();
  rows.forEach((r) => {
    PAYROLL_JOURNAL_MAP.forEach(([field, accountName]) => {
      const amt = Number(r[field]) || 0;
      if (amt > 0) byAccountName.set(accountName, (byAccountName.get(accountName) || 0) + amt);
    });
  });

  const netPayable = rows.reduce((s, r) => s + r.net, 0);
  const debitFields = new Set(PAYROLL_JOURNAL_MAP.filter(([, , side]) => side === "debit").map(([, name]) => name));
  const payableAccountId = await getAccountIdByName(tenantId, run.companyId, "رواتب مستحقة للصرف");

  const journalLines: { accountId: string; department: string; debit: number; credit: number }[] = [];
  for (const [accountName, amount] of byAccountName) {
    const accountId = await getAccountIdByName(tenantId, run.companyId, accountName);
    const isDebit = debitFields.has(accountName);
    journalLines.push({ accountId, department: "المالية والحسابات", debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount });
  }
  journalLines.push({ accountId: payableAccountId, department: "المالية والحسابات", debit: 0, credit: netPayable });

  const [y, m] = run.month.split("-").map(Number);
  const date = new Date(y, m - 1, 28);

  return prisma.$transaction(async (tx) => {
    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: run.companyId,
      date,
      memo: `كشف رواتب ${monthLabel(run.month)} — ${rows.length} موظف`,
      sourceModule: "payroll",
      sourceId: run.id,
      createdBy: userId,
      lines: journalLines,
    });
    return tx.payrollRun.update({ where: { id }, data: { status: "posted", journalEntryId: entry.id } });
  });
}

export async function unpostPayrollRun(tenantId: string, userId: string, id: string, pin: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");
  if (run.status !== "posted") throw badRequest("كشف الرواتب ليس مرحّلاً أصلاً");

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, run.journalEntryId);
    const updated = await tx.payrollRun.update({ where: { id }, data: { status: "draft", journalEntryId: null } });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "PayrollRun", entityId: id });
    return updated;
  });
}
