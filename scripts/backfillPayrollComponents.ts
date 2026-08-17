/**
 * تعبئة رجعية لإعدادات الرواتب المرنة (Phase H) — تُنشئ PayrollSettings + 11 بنداً نظامياً
 * (isSystem) لكل شركة، مطابقة حرفياً لـ PAYROLL_JOURNAL_MAP القديم بنفس الحسابات والقيم
 * الافتراضية بالضبط (لا يتغيّر راتب أي موظف يوم الترحيل)، وتُسند كل بند لكل موظف حالي، وتربط
 * صفوف HrAction القديمة بالبند المطابق بدل actionType الحر.
 *
 * ملاحظة مكتشَفة أثناء البناء: النظام القديم لم يكن له حساب مخصّص لخصم الغياب إطلاقاً (غائب من
 * PAYROLL_JOURNAL_MAP) رغم أنه يُخصَم فعلياً من صافي الراتب — ما يعني أن قيد الرواتب القديم كان
 * غير متوازن (مدين ≠ دائن) بمقدار إجمالي خصومات الغياب كلما وُجدت. هذه التعبئة تُصلح ذلك ضمنياً
 * بإسناد "خصم الغياب" لنفس حساب "استقطاعات أخرى مستحقة" المستخدَم للاستقطاعات الأخرى مسبقاً.
 *
 * الاستخدام:
 *   npx tsx scripts/backfillPayrollComponents.ts             # تقرير Dry-run فقط
 *   npx tsx scripts/backfillPayrollComponents.ts --commit     # تنفيذ فعلي بعد مراجعة التقرير
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { getAccountIdByName } from "../src/lib/wellKnownAccounts";
import {
  LEGACY_PAYROLL_COMPONENTS as SYSTEM_COMPONENTS,
  LEGACY_ACTION_TYPE_TO_KEY as ACTION_TYPE_TO_KEY,
  buildLegacyFormula,
  buildLegacyAdjustmentUnitBasis,
  LegacyComponentKey,
} from "../src/lib/legacyPayrollComponents";

const prisma = new PrismaClient();
const commit = process.argv.includes("--commit");

interface CompanyReport {
  companyName: string;
  needsSettings: boolean;
  missingComponents: string[];
  missingAccountWarnings: string[];
  employeeAssignmentsToCreate: number;
  hrActionsToLink: number;
}

async function reportForCompany(tenantId: string, companyId: string, companyName: string): Promise<CompanyReport> {
  const settings = await prisma.payrollSettings.findUnique({ where: { companyId } });
  const existingComponents = await prisma.payrollComponent.findMany({ where: { companyId, isSystem: true }, select: { systemKey: true } });
  const existingKeys = new Set(existingComponents.map((c) => c.systemKey));
  const missingComponents: string[] = [];
  const missingAccountWarnings: string[] = [];
  for (const spec of SYSTEM_COMPONENTS) {
    if (existingKeys.has(spec.key)) continue;
    try {
      await getAccountIdByName(tenantId, companyId, spec.accountName);
      missingComponents.push(spec.key);
    } catch {
      missingAccountWarnings.push(`${spec.key} (${spec.accountName})`);
    }
  }

  const employees = await prisma.employee.findMany({ where: { tenantId, companyId }, select: { id: true } });
  const componentCount = existingKeys.size + missingComponents.length;
  const assignedCounts = await prisma.employeePayrollComponent.count({
    where: { employeeId: { in: employees.map((e) => e.id) } },
  });
  const employeeAssignmentsToCreate = Math.max(employees.length * componentCount - assignedCounts, 0);

  const hrActionsToLink = await prisma.hrAction.count({
    where: { employeeId: { in: employees.map((e) => e.id) }, componentId: null, actionType: { in: Object.keys(ACTION_TYPE_TO_KEY) } },
  });

  return {
    companyName,
    needsSettings: !settings,
    missingComponents,
    missingAccountWarnings,
    employeeAssignmentsToCreate,
    hrActionsToLink,
  };
}

async function commitForCompany(tenantId: string, companyId: string) {
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

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, tenantId: true, name: true } });
  const reports: CompanyReport[] = [];
  for (const company of companies) {
    reports.push(await reportForCompany(company.tenantId, company.id, company.name));
  }

  const relevant = reports.filter((r) => r.needsSettings || r.missingComponents.length || r.employeeAssignmentsToCreate || r.hrActionsToLink || r.missingAccountWarnings.length);
  if (!relevant.length) {
    console.log("✅ كل الشركات لديها بالفعل إعدادات رواتب كاملة — لا يوجد شيء للتعبئة الرجعية.");
    return;
  }

  console.log(`\n=== تقرير تعبئة إعدادات الرواتب (${commit ? "تنفيذ فعلي" : "Dry-run — لم يُعدَّل شيء بعد"}) ===\n`);
  for (const r of relevant) {
    console.log(
      `${r.companyName}: ${r.needsSettings ? "إعدادات جديدة" : "إعدادات موجودة"}، ` +
      `${r.missingComponents.length} بند سيُنشأ، ${r.employeeAssignmentsToCreate} تعيين موظف-بند، ` +
      `${r.hrActionsToLink} صف HrAction سيُربَط ببند` +
      (r.missingAccountWarnings.length ? `، ⚠️ حسابات غير موجودة: ${r.missingAccountWarnings.join("، ")} (سيُتجاوَز هذا البند)` : ""),
    );
  }

  if (!commit) {
    console.log("\nهذا تقرير فقط — لم يتم تعديل أي بيانات. أعد التشغيل بـ --commit بعد المراجعة لتنفيذ التعبئة فعلياً.");
    return;
  }

  console.log("\nجارٍ التنفيذ الفعلي...\n");
  // فشل شركة واحدة (بيانات ناقصة/غير متسقة تحديداً بها) لا يجب أن يوقف التنفيذ عن بقية الشركات —
  // يُسجَّل الخطأ ويُتجاوَز، بنفس فلسفة "يُتجاوَز بأمان" المستخدَمة أصلاً للحسابات المفقودة.
  const failed: { name: string; error: unknown }[] = [];
  for (const company of companies) {
    try {
      await commitForCompany(company.tenantId, company.id);
      console.log(`  ✅ ${company.name} — تم`);
    } catch (err) {
      failed.push({ name: company.name, error: err });
      console.log(`  ❌ ${company.name} — فشل: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failed.length) {
    console.log(`\n⚠️ اكتملت التعبئة مع ${failed.length} شركة فشلت (راجع الرسائل أعلاه): ${failed.map((f) => f.name).join("، ")}`);
  } else {
    console.log("\n✅ اكتملت تعبئة إعدادات الرواتب.");
  }
}

main()
  .catch((err) => {
    console.error("خطأ أثناء تنفيذ السكريبت:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
