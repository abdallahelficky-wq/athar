/**
 * كتابة البنود النظامية الاثني عشر لشركة واحدة (PayrollSettings + PayrollComponent isSystem + إسنادها لكل موظف
 * + ربط HrAction القديمة) — منقولة حرفياً من scripts/backfillPayrollComponents.ts ليستخدمها السكربت واختبارات
 * التكامل من مصدر واحد (اختبار يُعِدّ بنوده بنفسه يختبر افتراضه لا النظام — CLAUDE.md 2).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { getAccountIdByName } from "./wellKnownAccounts";
import {
  LEGACY_PAYROLL_COMPONENTS as SYSTEM_COMPONENTS,
  LEGACY_ACTION_TYPE_TO_KEY as ACTION_TYPE_TO_KEY,
  buildLegacyFormula,
  buildLegacyAdjustmentUnitBasis,
  LegacyComponentKey,
} from "./legacyPayrollComponents";

export async function backfillSystemPayrollComponents(prisma: PrismaClient, tenantId: string, companyId: string) {
  const componentIdByKey = new Map<LegacyComponentKey, string>();
  const existing = await prisma.payrollComponent.findMany({ where: { companyId, isSystem: true } });
  existing.forEach((c) => { if (c.systemKey) componentIdByKey.set(c.systemKey as LegacyComponentKey, c.id); });

  await prisma.$transaction(async (tx) => {
    const settings = await tx.payrollSettings.findUnique({ where: { companyId } });
    if (!settings) {
      await tx.payrollSettings.create({
        data: { tenantId, companyId, standardHoursPerMonth: 240, standardDaysPerMonth: 30, payslipColumns: [] as Prisma.InputJsonValue },
      });
    }

    for (const spec of SYSTEM_COMPONENTS) {
      if (componentIdByKey.has(spec.key)) continue;
      let accountId: string;
      try {
        accountId = await getAccountIdByName(tenantId, companyId, spec.accountName);
      } catch {
        continue; // حساب هذا البند غير موجود في شجرة هذه الشركة — يُتجاوَز بأمان (نفس منطق التقرير)
      }
      const formula = buildLegacyFormula(spec, componentIdByKey);
      const adjustmentUnitBasis = buildLegacyAdjustmentUnitBasis(spec, componentIdByKey);

      const created = await tx.payrollComponent.create({
        data: {
          tenantId, companyId, name: spec.name, kind: spec.kind, accountId, calcMethod: spec.calcMethod,
          formula: formula as unknown as Prisma.InputJsonValue, adjustmentUnitBasis: adjustmentUnitBasis as unknown as Prisma.InputJsonValue,
          allowsMonthlyAdjustments: spec.allowsMonthlyAdjustments, prorateOnPartialMonth: spec.prorateOnPartialMonth,
          sourceEmployeeField: spec.sourceEmployeeField || null, isSystem: true, systemKey: spec.key,
        },
      });
      componentIdByKey.set(spec.key, created.id);
    }

    const employees = await tx.employee.findMany({ where: { tenantId, companyId } });
    for (const emp of employees) {
      const alreadyAssigned = await tx.employeePayrollComponent.findMany({ where: { employeeId: emp.id }, select: { componentId: true } });
      const assignedIds = new Set(alreadyAssigned.map((a) => a.componentId));
      for (const [key, componentId] of componentIdByKey) {
        if (assignedIds.has(componentId)) continue;
        const fixedValue =
          key === "advance" ? Number(emp.advances || 0)
          : key === "otherDed" ? Number(emp.otherDeductions || 0)
          : key === "gosi" && emp.gosiAmount != null ? Number(emp.gosiAmount)
          : null;
        await tx.employeePayrollComponent.create({
          data: {
            tenantId, employeeId: emp.id, componentId, fixedValue,
            isActive: key === "gosi" ? emp.gosiApplicable : true,
          },
        });
      }

      for (const [actionType, key] of Object.entries(ACTION_TYPE_TO_KEY)) {
        const componentId = componentIdByKey.get(key);
        if (!componentId) continue;
        await tx.hrAction.updateMany({ where: { employeeId: emp.id, actionType, componentId: null }, data: { componentId } });
      }
    }
  });
}
