import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { computeRun } from "../payrollRuns/payrollRuns.service";
import { annualLeaveBalance, latestContractAnniversary, roundMoney } from "./annualLeaveCalculation";
import type { AnnualLeaveDraftInput } from "./annualLeaveDraft.schemas";

export async function previewAnnualLeave(tenantId: string, input: AnnualLeaveDraftInput) {
  return (await computeAnnualLeave(tenantId, input)).snapshot;
}

/** الحساب الكامل للمسودة — اللقطة المعروضة/المحفوظة، ومعها صف كشف الرواتب وبنوده التي بُنيت منها، حتى يُبنى قيد الترحيل
 * من نفس الحساب الذي أنتج اللقطة لا من نسخة ثانية منه. */
export async function computeAnnualLeave(tenantId: string, input: AnnualLeaveDraftInput) {
  const emp = await prisma.employee.findFirst({ where: { id: input.employeeId, tenantId, companyId: input.companyId } });
  if (!emp) throw notFound("الموظف غير موجود");
  const date = new Date(input.leaveStartDate);
  if (date < emp.hireDate) throw badRequest("تاريخ الإجازة يسبق المباشرة");
  const [settings, previous, future, jobTitleRef, departmentRef] = await Promise.all([
    prisma.payrollSettings.findUnique({ where: { companyId: emp.companyId } }),
    prisma.leaveSettlement.findFirst({ where: { tenantId, employeeId: emp.id, leaveStartDate: { lt: date } }, orderBy: [{ leaveStartDate: "desc" }, { createdAt: "desc" }] }),
    prisma.leaveSettlement.findFirst({ where: { tenantId, employeeId: emp.id, leaveStartDate: { gte: date } }, select: { id: true } }),
    // المسمّى والقسم نصّان حرّان في ملف الموظف؛ نبحث عن اسمهما الإنجليزي داخل نفس المستأجر/الشركة فقط
    // حتى تُطبع المسودة بالإنجليزية كاملة حين تكون الواجهة إنجليزية.
    emp.jobTitle ? prisma.jobTitle.findFirst({ where: { tenantId, name: emp.jobTitle }, select: { nameEn: true } }) : null,
    emp.departmentId
      ? prisma.department.findFirst({ where: { id: emp.departmentId, tenantId }, select: { nameEn: true } })
      : emp.department ? prisma.department.findFirst({ where: { tenantId, name: emp.department, OR: [{ companyId: emp.companyId }, { companyId: null }] }, select: { nameEn: true } }) : null,
  ]);
  if (future) throw badRequest("توجد تسوية في هذا التاريخ أو بعده؛ راجعها قبل إعداد تسوية أقدم");
  if (previous && (input.openingDate || input.openingDays || input.openingAmount)) throw badRequest("الرصيد المرحل يُستخرج من التسوية السابقة ولا يقبل رصيداً افتتاحياً إضافياً");
  const pay = { basic: Number(emp.basicSalary), housing: Number(emp.housingAllowance), transport: Number(emp.transportAllowance), other: Number(emp.otherAllowance) };
  const total = pay.basic + pay.housing + pay.transport + pay.other;
  const basis = settings?.leaveSalaryBasis || "total", divisor = Number(settings?.leaveDailyRateDivisor ?? 30);
  const daily = (basis === "basic" ? pay.basic : basis === "basic_housing" ? pay.basic + pay.housing : total) / divisor;
  const anchorDate = previous?.leaveStartDate || (input.openingDate ? new Date(input.openingDate) : emp.hireDate);
  if (anchorDate < emp.hireDate || anchorDate > date) throw badRequest("تاريخ الرصيد الافتتاحي خارج مدة الخدمة حتى الإجازة");
  const through = input.balanceMode === "all" ? date : input.balanceMode === "contract_year"
    ? latestContractAnniversary(emp.hireDate, date) : new Date(input.balanceThroughDate!);
  if (through < anchorDate || through > date) throw badRequest("تاريخ احتساب الرصيد يجب أن يقع بين بداية الرصيد وتاريخ الإجازة");
  const balance = annualLeaveBalance({ hireDate: emp.hireDate, leaveDate: date, throughDate: through,
    before: Number(settings?.leaveDaysBeforeFive ?? 21), after: Number(settings?.leaveDaysAfterFive ?? 30), daily,
    anchorDate, carryDays: previous ? Number(previous.remainingLeaveDays) : input.openingDays,
    carryAmount: previous ? Math.max(Number(previous.leaveBalanceAmount) - Number(previous.leavePayAmount), 0) : input.openingAmount });
  const month = input.salaryMonth || input.leaveStartDate.slice(0, 7);
  if (month > input.leaveStartDate.slice(0, 7)) throw badRequest("شهر الراتب لا يجوز أن يلي تاريخ الإجازة");
  const standardDays = Number(settings?.standardDaysPerMonth ?? 30);
  const days = input.salaryMode === "none" ? 0 : input.salaryMode === "full_month" || month < input.leaveStartDate.slice(0, 7)
    ? standardDays : Math.min(date.getUTCDate() - 1, standardDays);
  const payrollRun = await prisma.payrollRun.findFirst({ where: { tenantId, companyId: emp.companyId, month } });
  const warnings: string[] = [];
  if (emp.leaveStatus === "onLeave") warnings.push("on_leave");
  if (payrollRun?.status === "posted" && payrollRun.employeeIds.includes(emp.id)) warnings.push("salary_already_posted");
  const computed = await computeRun(tenantId, { id: payrollRun?.id, companyId: emp.companyId, month, employeeIds: [emp.id],
    overrides: payrollRun?.overrides || {}, status: "draft", leavePreviewProration: days / standardDays });
  const row = computed.rows[0];
  if (row.advanceInstallments?.some(a => a.needsInstallment)) warnings.push("missing_installment");
  const includeSalary = input.salaryMode !== "none" && days > 0 && !warnings.includes("salary_already_posted");
  const lines = computed.components.filter(c => c.kind !== "employer").map(c => ({ id: c.id, name: c.name, kind: c.kind,
    systemKey: c.systemKey || null, sourceEmployeeField: c.sourceEmployeeField || null,
    amount: includeSalary ? roundMoney(row.componentValues[c.id] || 0) : 0 })).filter(c => c.amount !== 0);
  const salaryNet = includeSalary ? roundMoney(row.net) : 0;
  if (salaryNet < 0) warnings.push("negative_salary");
  const snapshot = { version: 2, draftOnly: true, request: input,
    employee: { id: emp.id, name: emp.name, employeeNumber: emp.employeeNumber, jobTitle: emp.jobTitle,
      jobTitleEn: jobTitleRef?.nameEn || null, department: emp.department, departmentEn: departmentRef?.nameEn || null, nationality: emp.nationality, hireDate: emp.hireDate.toISOString().slice(0, 10),
      contractEnd: emp.contractEnd?.toISOString().slice(0, 10) || null,
      lastLeaveDate: previous?.leaveStartDate.toISOString().slice(0, 10) || null,
      lastReturnDate: emp.lastLeaveReturnDate?.toISOString().slice(0, 10) || null, pay: { ...pay, total } },
    balance: { ...balance, anchorDate: anchorDate.toISOString().slice(0, 10), throughDate: through.toISOString().slice(0, 10),
      daily: roundMoney(daily), basis, divisor, hasPrevious: !!previous },
    salary: { month, days, lines, sourceRunId: payrollRun?.id || null, net: salaryNet,
      additions: includeSalary ? roundMoney(row.totalAdditions) : 0, deductions: includeSalary ? roundMoney(row.totalDeductions) : 0 },
    warnings, net: roundMoney(balance.payAmount + salaryNet + input.ticketAmount + input.otherAdditions) };
  return { snapshot, emp, components: computed.components, row, includeSalary };
}

export async function saveAnnualLeaveDraft(tenantId: string, userId: string, input: AnnualLeaveDraftInput) {
  // Recompute server-side; never accept a client-calculated amount or snapshot.
  const snapshot = await previewAnnualLeave(tenantId, input);
  return prisma.annualLeaveDraft.create({ data: { tenantId, companyId: input.companyId, employeeId: input.employeeId,
    createdBy: userId, request: input as Prisma.InputJsonValue, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
}

/** المسودة لا تُرحّل ولا تحجز رصيداً، فتعديلها أو حذفها لا يمسّ أي قيد أو رصيد. قرار المالك (2026-11-10): يعدّلها
 * أو يحذفها أي مستخدم له صلاحية على شركتها (فحص الشركة وصلاحيات المنصب في المسار)، لا معدّها وحده. */
export async function findDraft(tenantId: string, id: string) {
  const draft = await prisma.annualLeaveDraft.findFirst({ where: { id, tenantId } });
  if (!draft) throw notFound("مسودة الإجازة غير موجودة");
  return draft;
}

export async function updateAnnualLeaveDraft(tenantId: string, id: string, input: AnnualLeaveDraftInput) {
  const draft = await findDraft(tenantId, id);
  if (draft.status === "posted") throw badRequest("مسودة الإجازة مرحّلة ولا يمكن تعديلها");
  if (input.companyId !== draft.companyId) throw badRequest("لا يمكن نقل مسودة الإجازة إلى شركة أخرى");
  const snapshot = await previewAnnualLeave(tenantId, input);
  return prisma.annualLeaveDraft.update({ where: { id: draft.id }, data: { employeeId: input.employeeId,
    request: input as Prisma.InputJsonValue, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
}

export async function deleteAnnualLeaveDraft(tenantId: string, id: string) {
  const draft = await findDraft(tenantId, id);
  if (draft.status === "posted") throw badRequest("مسودة الإجازة مرحّلة ولا يمكن حذفها");
  await prisma.annualLeaveDraft.delete({ where: { id: draft.id } });
  return { id: draft.id };
}
