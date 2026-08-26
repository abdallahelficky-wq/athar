import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { findCircularReference, PayrollComponentLike, AdjustmentUnitBasis, PayrollFormula } from "../../lib/payrollEngine";
import { toComponentLike } from "../../lib/payrollComponentMapper";
import { resolveEffectiveComponents } from "../payrollRuns/payrollRuns.service";

/**
 * قائمة البنود القابلة لتسوية شهرية (HrAction) لهذه الشركة — تشمل البنود النظامية المؤقتة
 * (legacy:<key>) لشركة لم يُشغَّل لها backfillPayrollComponents.ts بعد، بنفس آلية الاحتياط
 * المستخدَمة في ترحيل الرواتب (resolveEffectiveComponents)، حتى تعمل شاشة "إجراءات الموظفين"
 * بلا انقطاع بغض النظر عن حالة الـ backfill.
 */
export async function listAdjustableComponents(tenantId: string, companyId: string) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  const { components } = await resolveEffectiveComponents(tenantId, companyId);
  return components
    .filter((c) => c.allowsMonthlyAdjustments)
    .map((c) => ({ componentId: c.id, name: c.name, kind: c.kind }));
}

async function assertCompanyBelongsToTenant(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
}

async function assertValidAccount(tenantId: string, companyId: string, accountId: string) {
  const account = await prisma.account.findFirst({ where: { id: accountId, tenantId, companyId, isPosting: true, isActive: true, isArchived: false } });
  if (!account) throw badRequest("الحساب المحدد غير صالح للترحيل ضمن شجرة هذه الشركة");
}

export async function listPayrollComponents(tenantId: string, companyId: string) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  return prisma.payrollComponent.findMany({ where: { tenantId, companyId }, include: { account: true }, orderBy: { sortOrder: "asc" } });
}

interface ComponentInput {
  name: string;
  kind: "addition" | "deduction";
  accountId: string;
  calcMethod: "fixed" | "formula";
  formula?: PayrollFormula | null;
  adjustmentUnitBasis?: AdjustmentUnitBasis | null;
  allowsMonthlyAdjustments: boolean;
  prorateOnPartialMonth: boolean;
  appliesByDefault: boolean;
  sortOrder: number;
}

export async function createPayrollComponent(tenantId: string, companyId: string, input: ComponentInput) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  await assertValidAccount(tenantId, companyId, input.accountId);

  const existing = await prisma.payrollComponent.findMany({ where: { tenantId, companyId } });
  const candidate: PayrollComponentLike = {
    id: "__new__", kind: input.kind, calcMethod: input.calcMethod,
    formula: input.formula ?? null, adjustmentUnitBasis: input.adjustmentUnitBasis ?? null,
    sourceEmployeeField: null, prorateOnPartialMonth: input.prorateOnPartialMonth,
  };
  const cycle = findCircularReference([...existing.map(toComponentLike), candidate]);
  if (cycle) throw badRequest(`الصيغة تحتوي على مرجع دائري بين البنود: ${cycle.join(" → ")}`);

  return prisma.payrollComponent.create({
    data: {
      tenantId, companyId, name: input.name, kind: input.kind, accountId: input.accountId, calcMethod: input.calcMethod,
      formula: (input.formula ?? null) as unknown as Prisma.InputJsonValue, adjustmentUnitBasis: (input.adjustmentUnitBasis ?? null) as unknown as Prisma.InputJsonValue,
      allowsMonthlyAdjustments: input.allowsMonthlyAdjustments, prorateOnPartialMonth: input.prorateOnPartialMonth,
      appliesByDefault: input.appliesByDefault, sortOrder: input.sortOrder, isSystem: false,
    },
  });
}

export async function updatePayrollComponent(tenantId: string, id: string, input: Partial<ComponentInput> & { isActive?: boolean }) {
  const existing = await prisma.payrollComponent.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("بند الرواتب غير موجود");
  if (input.accountId) await assertValidAccount(tenantId, existing.companyId, input.accountId);

  const merged: PayrollComponentLike = {
    id: existing.id,
    kind: input.kind ?? (existing.kind as "addition" | "deduction"),
    calcMethod: input.calcMethod ?? (existing.calcMethod as "fixed" | "formula"),
    formula: input.formula !== undefined ? input.formula : (existing.formula as unknown as PayrollFormula | null),
    adjustmentUnitBasis: input.adjustmentUnitBasis !== undefined ? input.adjustmentUnitBasis : (existing.adjustmentUnitBasis as unknown as AdjustmentUnitBasis | null),
    sourceEmployeeField: existing.sourceEmployeeField as PayrollComponentLike["sourceEmployeeField"],
    prorateOnPartialMonth: input.prorateOnPartialMonth ?? existing.prorateOnPartialMonth,
  };
  const others = await prisma.payrollComponent.findMany({ where: { tenantId, companyId: existing.companyId, id: { not: id } } });
  const cycle = findCircularReference([...others.map(toComponentLike), merged]);
  if (cycle) throw badRequest(`الصيغة تحتوي على مرجع دائري بين البنود: ${cycle.join(" → ")}`);

  return prisma.payrollComponent.update({
    where: { id },
    data: {
      name: input.name, accountId: input.accountId, kind: input.kind, calcMethod: input.calcMethod,
      formula: input.formula !== undefined ? (input.formula as unknown as Prisma.InputJsonValue) : undefined,
      adjustmentUnitBasis: input.adjustmentUnitBasis !== undefined ? (input.adjustmentUnitBasis as unknown as Prisma.InputJsonValue) : undefined,
      allowsMonthlyAdjustments: input.allowsMonthlyAdjustments, prorateOnPartialMonth: input.prorateOnPartialMonth,
      appliesByDefault: input.appliesByDefault, sortOrder: input.sortOrder, isActive: input.isActive,
    },
  });
}

/** يمنع حذف البنود النظامية (isSystem) أو المرتبطة بموظفين/حركات سابقة — إيقافها (isActive) هو البديل الآمن */
export async function deletePayrollComponent(tenantId: string, id: string) {
  const existing = await prisma.payrollComponent.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("بند الرواتب غير موجود");
  if (existing.isSystem) throw badRequest("لا يمكن حذف بند نظامي — استخدم إيقافه (isActive) بدلاً من ذلك");

  const [assignments, actions] = await Promise.all([
    prisma.employeePayrollComponent.count({ where: { componentId: id } }),
    prisma.hrAction.count({ where: { componentId: id } }),
  ]);
  if (assignments || actions) throw badRequest("لا يمكن حذف بند مرتبط بموظفين أو حركات سابقة — أوقفه (isActive) بدلاً من ذلك");

  await prisma.payrollComponent.delete({ where: { id } });
}

export async function getPayrollSettings(tenantId: string, companyId: string) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  const existing = await prisma.payrollSettings.findUnique({ where: { companyId } });
  if (existing) return existing;
  return { id: null, tenantId, companyId, standardHoursPerMonth: 240, standardDaysPerMonth: 30,
    leaveDaysBeforeFive: 21, leaveDaysAfterFive: 30, leaveDailyRateDivisor: 30,
    leaveSalaryBasis: "total", eosSalaryBasis: "basic_housing", payslipColumns: [] as unknown[] };
}

interface SettingsInput {
  standardHoursPerMonth?: number;
  standardDaysPerMonth?: number;
  leaveDaysBeforeFive?: number;
  leaveDaysAfterFive?: number;
  leaveDailyRateDivisor?: number;
  leaveSalaryBasis?: "basic" | "basic_housing" | "total";
  eosSalaryBasis?: "basic" | "basic_housing" | "total";
  payslipColumns?: { componentId: string | null; label: string }[];
}

export async function updatePayrollSettings(tenantId: string, companyId: string, input: SettingsInput) {
  await assertCompanyBelongsToTenant(tenantId, companyId);
  return prisma.payrollSettings.upsert({
    where: { companyId },
    create: {
      tenantId, companyId,
      standardHoursPerMonth: input.standardHoursPerMonth ?? 240,
      standardDaysPerMonth: input.standardDaysPerMonth ?? 30,
      leaveDaysBeforeFive: input.leaveDaysBeforeFive ?? 21,
      leaveDaysAfterFive: input.leaveDaysAfterFive ?? 30,
      leaveDailyRateDivisor: input.leaveDailyRateDivisor ?? 30,
      leaveSalaryBasis: input.leaveSalaryBasis ?? "total",
      eosSalaryBasis: input.eosSalaryBasis ?? "basic_housing",
      payslipColumns: (input.payslipColumns ?? []) as unknown as Prisma.InputJsonValue,
    } as any,
    update: {
      ...(input.standardHoursPerMonth != null && { standardHoursPerMonth: input.standardHoursPerMonth }),
      ...(input.standardDaysPerMonth != null && { standardDaysPerMonth: input.standardDaysPerMonth }),
      ...(input.leaveDaysBeforeFive != null && { leaveDaysBeforeFive: input.leaveDaysBeforeFive }),
      ...(input.leaveDaysAfterFive != null && { leaveDaysAfterFive: input.leaveDaysAfterFive }),
      ...(input.leaveDailyRateDivisor != null && { leaveDailyRateDivisor: input.leaveDailyRateDivisor }),
      ...(input.leaveSalaryBasis != null && { leaveSalaryBasis: input.leaveSalaryBasis }),
      ...(input.eosSalaryBasis != null && { eosSalaryBasis: input.eosSalaryBasis }),
      ...(input.payslipColumns != null && { payslipColumns: input.payslipColumns as unknown as Prisma.InputJsonValue }),
    } as any,
  });
}

export async function getEmployeePayrollComponents(tenantId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!employee) throw notFound("الموظف غير موجود");

  const [components, assignments] = await Promise.all([
    prisma.payrollComponent.findMany({ where: { tenantId, companyId: employee.companyId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.employeePayrollComponent.findMany({ where: { employeeId } }),
  ]);
  const byComponentId = new Map(assignments.map((a) => [a.componentId, a]));

  return components.map((c) => ({
    componentId: c.id, name: c.name, kind: c.kind, calcMethod: c.calcMethod, isSystem: c.isSystem,
    assigned: byComponentId.get(c.id)?.isActive ?? false,
    fixedValue: byComponentId.get(c.id)?.fixedValue ?? null,
    needsFixedValue: c.calcMethod === "fixed" && !c.sourceEmployeeField,
  }));
}

export async function setEmployeePayrollComponents(
  tenantId: string,
  employeeId: string,
  items: { componentId: string; isActive: boolean; fixedValue?: number | null }[],
) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
  if (!employee) throw notFound("الموظف غير موجود");

  const componentIds = [...new Set(items.map((i) => i.componentId))];
  const validCount = await prisma.payrollComponent.count({ where: { id: { in: componentIds }, tenantId, companyId: employee.companyId } });
  if (validCount !== componentIds.length) throw badRequest("أحد البنود المختارة غير موجود ضمن بنود رواتب هذه الشركة");

  return prisma.$transaction(
    items.map((item) =>
      prisma.employeePayrollComponent.upsert({
        where: { employeeId_componentId: { employeeId, componentId: item.componentId } },
        create: { tenantId, employeeId, componentId: item.componentId, isActive: item.isActive, fixedValue: item.fixedValue ?? null },
        update: { isActive: item.isActive, fixedValue: item.fixedValue ?? null },
      }),
    ),
  );
}
