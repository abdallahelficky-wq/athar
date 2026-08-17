import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { daysInMonth } from "../../lib/hrCalculations";
import { computeEmployeePayroll, PayrollComponentLike, PayrollSettingsLike } from "../../lib/payrollEngine";
import { toComponentLike } from "../../lib/payrollComponentMapper";
import {
  LEGACY_PAYROLL_COMPONENTS,
  LEGACY_ACTION_TYPE_TO_KEY,
  LegacyComponentKey,
  buildLegacyFormula,
  buildLegacyAdjustmentUnitBasis,
} from "../../lib/legacyPayrollComponents";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
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

/** override بالمُعرِّف: مفاتيح الكائن هي componentId (أو "legacy:<key>" لشركة لم تُهاجَر بعد) */
export async function setRowOverride(tenantId: string, id: string, employeeId: string, override: Record<string, number>) {
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

export interface RunComponent extends PayrollComponentLike {
  name: string;
  accountId: string;
  allowsMonthlyAdjustments: boolean;
}

interface RunRow {
  employeeId: string;
  employeeName: string;
  componentValues: Record<string, number>;
  totalAdditions: number;
  totalDeductions: number;
  net: number;
  note: string;
  overridden: boolean;
}

/**
 * تُرجع بنود الرواتب الفعّالة لهذه الشركة: البنود الحقيقية المحفوظة إن كانت موجودة (بعد تشغيل
 * backfillPayrollComponents.ts)، وإلا توليف مؤقت في الذاكرة لنفس البنود الاثني عشر القديمة بلا أي
 * كتابة لقاعدة البيانات — يضمن صفر تغيير في راتب أي موظف قبل تشغيل الـ backfill صراحةً، تماماً
 * كمبدأ resolvePartyAccountId في partyAccounts.ts (Phase G).
 */
export async function resolveEffectiveComponents(tenantId: string, companyId: string): Promise<{ components: RunComponent[]; persisted: boolean }> {
  const dbComponents = await prisma.payrollComponent.findMany({ where: { tenantId, companyId, isActive: true }, orderBy: { sortOrder: "asc" } });
  if (dbComponents.length) {
    return {
      persisted: true,
      components: dbComponents.map((c) => ({ ...toComponentLike(c), name: c.name, accountId: c.accountId, allowsMonthlyAdjustments: c.allowsMonthlyAdjustments })),
    };
  }

  const idByKey = new Map<LegacyComponentKey, string>();
  LEGACY_PAYROLL_COMPONENTS.forEach((spec) => idByKey.set(spec.key, `legacy:${spec.key}`));
  const components: RunComponent[] = [];
  for (const spec of LEGACY_PAYROLL_COMPONENTS) {
    let accountId: string;
    try {
      accountId = await getAccountIdByName(tenantId, companyId, spec.accountName);
    } catch {
      continue; // حساب هذا البند غير موجود في شجرة هذه الشركة تحديداً — يُتجاوَز بأمان
    }
    components.push({
      id: idByKey.get(spec.key)!, name: spec.name, kind: spec.kind, accountId, calcMethod: spec.calcMethod,
      formula: buildLegacyFormula(spec, idByKey), adjustmentUnitBasis: buildLegacyAdjustmentUnitBasis(spec, idByKey),
      sourceEmployeeField: spec.sourceEmployeeField || null, prorateOnPartialMonth: spec.prorateOnPartialMonth,
      allowsMonthlyAdjustments: spec.allowsMonthlyAdjustments,
    });
  }
  return { components, persisted: false };
}

async function computeRun(tenantId: string, run: { companyId: string; month: string; employeeIds: string[]; overrides: unknown }): Promise<{ components: RunComponent[]; rows: RunRow[] }> {
  const { components, persisted } = await resolveEffectiveComponents(tenantId, run.companyId);
  const employees = await prisma.employee.findMany({ where: { id: { in: run.employeeIds }, tenantId } });
  const settlements = await prisma.leaveSettlement.findMany({ where: { employeeId: { in: run.employeeIds } } });
  const settingsRow = await prisma.payrollSettings.findUnique({ where: { companyId: run.companyId } });
  const settings: PayrollSettingsLike = {
    standardHoursPerMonth: settingsRow ? Number(settingsRow.standardHoursPerMonth) : 240,
    standardDaysPerMonth: settingsRow ? Number(settingsRow.standardDaysPerMonth) : 30,
  };
  const overridesMap = (run.overrides as Record<string, Record<string, number>>) || {};

  const empComponentRows = persisted
    ? await prisma.employeePayrollComponent.findMany({ where: { employeeId: { in: run.employeeIds }, isActive: true } })
    : [];
  const actionsRaw = persisted
    ? await prisma.hrAction.findMany({ where: { employeeId: { in: run.employeeIds }, month: run.month, componentId: { not: null } } })
    : await prisma.hrAction.findMany({ where: { employeeId: { in: run.employeeIds }, month: run.month } });

  // سلف الموظفين النشطة المرتبطة ببند مخصَّص (Phase E) — قيمة الخصم الفعلية هذا الشهر هي الأقل بين
  // القسط الشهري المحفوظ (EmployeePayrollComponent.fixedValue) والرصيد المتبقي فعلياً، حتى لا يتجاوز
  // القسط الأخير المبلغ المتبقي. المفتاح هو EmployeePayrollComponent.id (وليس componentId).
  const activeAdvances = persisted
    ? await prisma.employeeAdvance.findMany({
        where: { tenantId, companyId: run.companyId, employeeId: { in: run.employeeIds }, status: "active", employeePayrollComponentId: { not: null } },
      })
    : [];
  const advanceByEmployeePayrollComponentId = new Map(activeAdvances.map((a) => [a.employeePayrollComponentId!, a]));

  const rows = run.employeeIds.map((employeeId): RunRow => {
    const emp = employees.find((e) => e.id === employeeId)!;
    const empSettlements = settlements.filter((s) => s.employeeId === employeeId);
    const onLeaveThisMonth = empSettlements.some((s) => s.leaveStartDate.toISOString().slice(0, 7) === run.month && !s.returnDate);
    const returning = empSettlements.find((s) => s.returnDate && s.returnDate.toISOString().slice(0, 7) === run.month);
    let prorationFactor: number | null = null;
    if (returning) {
      const dim = daysInMonth(run.month);
      const workedDays = Math.max(dim - returning.returnDate!.getDate() + 1, 0);
      prorationFactor = workedDays / dim;
    }

    let employeeComponents: RunComponent[];
    const fixedValues = new Map<string, number>();
    const monthlyAdjustments = new Map<string, number>();

    if (persisted) {
      const assignedIds = new Set(empComponentRows.filter((ec) => ec.employeeId === employeeId).map((ec) => ec.componentId));
      employeeComponents = components.filter((c) => assignedIds.has(c.id));
      empComponentRows
        .filter((ec) => ec.employeeId === employeeId && ec.fixedValue != null)
        .forEach((ec) => {
          let value = Number(ec.fixedValue);
          const advance = advanceByEmployeePayrollComponentId.get(ec.id);
          if (advance) value = Math.min(value, Number(advance.remainingBalance));
          fixedValues.set(ec.componentId, value);
        });
      actionsRaw
        .filter((a) => a.employeeId === employeeId && a.componentId)
        .forEach((a) => monthlyAdjustments.set(a.componentId!, (monthlyAdjustments.get(a.componentId!) || 0) + Number(a.value)));
    } else {
      employeeComponents = emp.gosiApplicable ? components : components.filter((c) => c.id !== "legacy:gosi");
      if (Number(emp.advances)) fixedValues.set("legacy:advance", Number(emp.advances));
      if (Number(emp.otherDeductions)) fixedValues.set("legacy:otherDed", Number(emp.otherDeductions));
      if (emp.gosiAmount != null) fixedValues.set("legacy:gosi", Number(emp.gosiAmount));
      actionsRaw
        .filter((a) => a.employeeId === employeeId)
        .forEach((a) => {
          const key = LEGACY_ACTION_TYPE_TO_KEY[a.actionType];
          if (!key) return;
          const id = `legacy:${key}`;
          monthlyAdjustments.set(id, (monthlyAdjustments.get(id) || 0) + Number(a.value));
        });
    }

    const result = computeEmployeePayroll({
      employee: {
        basicSalary: Number(emp.basicSalary), housingAllowance: Number(emp.housingAllowance),
        transportAllowance: Number(emp.transportAllowance), otherAllowance: Number(emp.otherAllowance),
      },
      components: employeeComponents, fixedValues, monthlyAdjustments, settings,
      fullyOnLeave: onLeaveThisMonth, prorationFactor,
    });

    let values = result.values;
    let totalAdditions = result.totalAdditions;
    let totalDeductions = result.totalDeductions;
    let overridden = false;
    const override = overridesMap[employeeId];
    if (override) {
      values = new Map(values);
      for (const [componentId, value] of Object.entries(override)) values.set(componentId, value);
      totalAdditions = employeeComponents.filter((c) => c.kind === "addition").reduce((s, c) => s + (values.get(c.id) || 0), 0);
      totalDeductions = employeeComponents.filter((c) => c.kind === "deduction").reduce((s, c) => s + (values.get(c.id) || 0), 0);
      overridden = true;
    }

    return {
      employeeId, employeeName: emp.name, componentValues: Object.fromEntries(values),
      totalAdditions, totalDeductions, net: totalAdditions - totalDeductions, note: result.note, overridden,
    };
  });

  return { components, rows };
}

export async function getPayrollRunRows(tenantId: string, id: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");

  const { components, rows } = await computeRun(tenantId, run);

  const byComponent: Record<string, number> = {};
  components.forEach((c) => { byComponent[c.id] = 0; });
  rows.forEach((r) => { for (const [componentId, value] of Object.entries(r.componentValues)) byComponent[componentId] = (byComponent[componentId] || 0) + value; });

  const totals = {
    byComponent,
    totalAdditions: rows.reduce((s, r) => s + r.totalAdditions, 0),
    totalDeductions: rows.reduce((s, r) => s + r.totalDeductions, 0),
    net: rows.reduce((s, r) => s + r.net, 0),
  };

  return { run, rows, totals, columns: components.map((c) => ({ id: c.id, name: c.name, kind: c.kind })) };
}

export async function postPayrollRun(tenantId: string, userId: string, id: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");
  if (run.status === "posted") throw badRequest("كشف الرواتب مرحّل بالفعل");

  const { components, rows } = await computeRun(tenantId, run);
  if (rows.length === 0) throw badRequest("لا يوجد موظفون في هذا الكشف");
  const componentById = new Map(components.map((c) => [c.id, c]));

  // سلف نشطة مرتبطة ببند مخصَّص — تُستخدَم هنا لضمان أن القيمة الفعلية المُرحَّلة لا تتجاوز الرصيد
  // المتبقي إطلاقاً (احترازاً حتى لو عدّلت الموارد البشرية القيمة يدوياً عبر override)، ولتسجيل خصم
  // فعلي (EmployeeAdvanceDeduction) لكل سلفة بعد الترحيل مباشرة ضمن نفس المعاملة.
  const activeAdvances = await prisma.employeeAdvance.findMany({
    where: { tenantId, companyId: run.companyId, employeeId: { in: run.employeeIds }, status: "active", employeePayrollComponentId: { not: null } },
    include: { employeePayrollComponent: true },
  });
  const advanceByComponentId = new Map(activeAdvances.filter((a) => a.employeePayrollComponent).map((a) => [a.employeePayrollComponent!.componentId, a]));

  // سطر واحد لكل موظف لكل بند غير صفري (موسوم بـ employeeId)، ثم سطر ختامي واحد لكل موظف: صافي
  // المستحق يُقيَّد على حسابه المستقل هو (Phase G) — بدل جمع كل الموظفين في سطر واحد بلا أي وسم
  // بالموظف كما كان في المنطق القديم.
  const employees = await prisma.employee.findMany({ where: { id: { in: run.employeeIds }, tenantId }, select: { id: true, accountId: true } });
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const journalLines: { accountId: string; department: string; debit: number; credit: number; employeeId?: string; employeeAdvanceId?: string }[] = [];
  const advanceDeductions: { advanceId: string; amount: number }[] = [];
  for (const row of rows) {
    for (const [componentId, rawValue] of Object.entries(row.componentValues)) {
      if (!rawValue) continue;
      const component = componentById.get(componentId);
      if (!component) continue;
      const advance = advanceByComponentId.get(componentId);
      const value = advance ? Math.min(rawValue, Number(advance.remainingBalance)) : rawValue;
      if (!value) continue;
      const isDebit = component.kind === "addition";
      journalLines.push({
        accountId: component.accountId, department: "المالية والحسابات", debit: isDebit ? value : 0, credit: isDebit ? 0 : value,
        employeeId: row.employeeId, employeeAdvanceId: advance?.id,
      });
      if (advance) advanceDeductions.push({ advanceId: advance.id, amount: value });
    }
    if (!row.net) continue;
    const employee = employeeById.get(row.employeeId)!;
    const netAccountId = await resolvePartyAccountId(tenantId, run.companyId, employee, "رواتب مستحقة للصرف");
    journalLines.push({ accountId: netAccountId, department: "المالية والحسابات", debit: 0, credit: row.net, employeeId: row.employeeId });
  }

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

    for (const { advanceId, amount } of advanceDeductions) {
      await tx.employeeAdvanceDeduction.create({ data: { employeeAdvanceId: advanceId, payrollRunId: id, amount } });
      const advance = await tx.employeeAdvance.findUniqueOrThrow({ where: { id: advanceId } });
      const remainingBalance = Math.max(Number(advance.remainingBalance) - amount, 0);
      const settled = remainingBalance <= 0;
      await tx.employeeAdvance.update({ where: { id: advanceId }, data: { remainingBalance, status: settled ? "settled" : "active" } });
      if (settled && advance.employeePayrollComponentId) {
        await tx.employeePayrollComponent.update({ where: { id: advance.employeePayrollComponentId }, data: { isActive: false } });
      }
    }

    return tx.payrollRun.update({ where: { id }, data: { status: "posted", journalEntryId: entry.id } });
  });
}

export async function unpostPayrollRun(tenantId: string, userId: string, id: string, pin: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");
  if (run.status !== "posted") throw badRequest("كشف الرواتب ليس مرحّلاً أصلاً");

  await assertValidUnlockPin(tenantId, pin);

  return prisma.$transaction(async (tx) => {
    // يُرجِع رصيد أي سلفة نُقِص منها هذا التشغيل بالضبط بنفس المبلغ المسجَّل وقت الترحيل (لا يُعاد
    // حسابه تخمينياً من الحالة الحالية)، ويعيد تفعيل بند الخصم لو كانت السلفة قد استقرّت "settled"
    // بسبب هذا الخصم بالذات — قبل حذف سجلات الخصم نفسها حتى لا تتكرر عند إعادة الترحيل لاحقاً.
    const deductions = await tx.employeeAdvanceDeduction.findMany({ where: { payrollRunId: id } });
    for (const d of deductions) {
      const advance = await tx.employeeAdvance.findUnique({ where: { id: d.employeeAdvanceId } });
      if (!advance) continue;
      const remainingBalance = Number(advance.remainingBalance) + Number(d.amount);
      await tx.employeeAdvance.update({ where: { id: advance.id }, data: { remainingBalance, status: "active" } });
      if (advance.status === "settled" && advance.employeePayrollComponentId) {
        await tx.employeePayrollComponent.update({ where: { id: advance.employeePayrollComponentId }, data: { isActive: true } });
      }
    }
    await tx.employeeAdvanceDeduction.deleteMany({ where: { payrollRunId: id } });

    await deleteJournalEntryTx(tx, run.journalEntryId);
    const updated = await tx.payrollRun.update({ where: { id }, data: { status: "draft", journalEntryId: null } });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "PayrollRun", entityId: id });
    return updated;
  });
}
