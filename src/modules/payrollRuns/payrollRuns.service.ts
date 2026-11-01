import { applyEmployeeGosi, isEmployeeGosi } from "../../lib/employeeGosi";
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
import { buildPayrollJournal, JournalComponent, EmployeeAllocation, NET_PAYABLE_ACCOUNT_NAME } from "./payrollJournal";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";
import { KSA_DATE_OPTIONS } from "../../lib/displayDates";

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  // التقويم مُثبَّت: الافتراضي لـ"ar-SA" يتبع نسخة ICU (هجري في بعضها)، وهذا النص يُحفَظ في بيان القيد نفسه
  return new Date(y, m - 1, 1).toLocaleDateString("ar-SA", { ...KSA_DATE_OPTIONS, year: "numeric", month: "long" });
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
  contraAccountId?: string | null;
  allowsMonthlyAdjustments: boolean;
}

interface RunRow {
  employeeId: string;
  employeeName: string;
  jobTitle?: string;
  employeeNumber?: string;
  monthlyBasic?: number;
  workedDays?: number;
  standardDays?: number;
  paymentMethod?: string | null;
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
      components: dbComponents.map((c) => ({ ...toComponentLike(c), name: c.name, accountId: c.accountId, contraAccountId: c.contraAccountId, allowsMonthlyAdjustments: c.allowsMonthlyAdjustments })),
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
      systemKey: spec.key, id: idByKey.get(spec.key)!, name: spec.name, kind: spec.kind, accountId, calcMethod: spec.calcMethod,
      formula: buildLegacyFormula(spec, idByKey), adjustmentUnitBasis: buildLegacyAdjustmentUnitBasis(spec, idByKey),
      sourceEmployeeField: spec.sourceEmployeeField || null, prorateOnPartialMonth: spec.prorateOnPartialMonth,
      allowsMonthlyAdjustments: spec.allowsMonthlyAdjustments,
    });
  }
  return { components, persisted: false };
}

async function computeRun(tenantId: string, run: { companyId: string; month: string; employeeIds: string[]; overrides: unknown; status?: string }): Promise<{ components: RunComponent[]; rows: RunRow[] }> {
  const effective = await resolveEffectiveComponents(tenantId, run.companyId);
  const { persisted } = effective;
  const employees = await prisma.employee.findMany({ where: { id: { in: run.employeeIds }, tenantId } });
  const settlements = await prisma.leaveSettlement.findMany({ where: { employeeId: { in: run.employeeIds } } });
  const settingsRow = await prisma.payrollSettings.findUnique({ where: { companyId: run.companyId } });
  // مساهمات صاحب العمل لا تدخل الكشف إلا بتشغيلها صراحة في إعدادات الرواتب (مطفأة افتراضياً — منعاً للتكرار مع قيد يدوي)
  const components = settingsRow?.employerContributionsEnabled ? effective.components : effective.components.filter((c) => c.kind !== "employer");
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

    if (run.status !== "posted") employeeComponents = applyEmployeeGosi(emp, employeeComponents, fixedValues, monthlyAdjustments);

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
      for (const [componentId, value] of Object.entries(override)) {
        if (run.status !== "posted" && !emp.gosiApplicable && components.some(c => c.id === componentId && isEmployeeGosi(c))) continue;
        values.set(componentId, value);
      }
      totalAdditions = employeeComponents.filter((c) => c.kind === "addition").reduce((s, c) => s + (values.get(c.id) || 0), 0);
      totalDeductions = employeeComponents.filter((c) => c.kind === "deduction").reduce((s, c) => s + (values.get(c.id) || 0), 0);
      overridden = true;
    }

    return {
      employeeId, employeeName: emp.name, jobTitle: emp.jobTitle || "", employeeNumber: emp.employeeNumber || "",
      monthlyBasic: Number(emp.basicSalary), standardDays: settings.standardDaysPerMonth, workedDays: onLeaveThisMonth ? 0 : Math.round(settings.standardDaysPerMonth * (prorationFactor ?? 1)), paymentMethod: emp.payrollPaymentMethod, componentValues: Object.fromEntries(values),
      totalAdditions, totalDeductions, net: totalAdditions - totalDeductions, note: result.note, overridden,
    };
  });

  return { components, rows };
}

export async function getPayrollRunRows(tenantId: string, id: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");

  const { components, rows } = run.status === "posted" && run.postedSnapshot
    ? run.postedSnapshot as unknown as { components: RunComponent[]; rows: RunRow[] }
    : await computeRun(tenantId, run);

  const byComponent: Record<string, number> = {};
  components.forEach((c) => { byComponent[c.id] = 0; });
  rows.forEach((r) => { for (const [componentId, value] of Object.entries(r.componentValues)) byComponent[componentId] = (byComponent[componentId] || 0) + value; });

  const totals = {
    byComponent,
    totalAdditions: rows.reduce((s, r) => s + r.totalAdditions, 0),
    totalDeductions: rows.reduce((s, r) => s + r.totalDeductions, 0),
    net: rows.reduce((s, r) => s + r.net, 0),
  };

  // تحذير التخصيص: موظفون بلا قسم أو مركز تكلفة تُرحَّل أسطر مصروفاتهم في مجموعة «غير مخصص» (لا قسم افتراضي)
  const unallocated = run.status === "posted" ? [] : await prisma.employee.findMany({
    where: { id: { in: run.employeeIds }, tenantId, companyId: run.companyId, OR: [{ departmentId: null }, { costCenterId: null }] },
    select: { id: true, name: true, departmentId: true, costCenterId: true },
  });
  const warnings = {
    unallocatedEmployees: unallocated.map((e) => ({ employeeId: e.id, name: e.name, missingDepartment: !e.departmentId, missingCostCenter: !e.costCenterId })),
  };

  return { run, rows, totals, warnings, columns: components.map((c) => ({ id: c.id, name: c.name, kind: c.kind, systemKey: c.systemKey, sourceEmployeeField: c.sourceEmployeeField })) };
}

/**
 * يحلّ كل ما يحتاجه buildPayrollJournal من القاعدة: حساب الصافي «رواتب مستحقة» (بالاسم، بلا بدائل — فلا ارتداد
 * صامت لحساب آخر)، أنواع الحسابات (للتخصيص على أسطر المصروفات فقط)، وقسم/مركز كل موظف من سجله.
 */
async function resolveJournalContext(
  tenantId: string,
  companyId: string,
  employeeIds: string[],
  rows: RunRow[],
  components: RunComponent[],
  advanceByComponentId: Map<string, { id: string; remainingBalance: Prisma.Decimal }>,
  mode: "totals" | "perEmployee",
) {
  const netPayable = await prisma.account.findFirst({
    where: { tenantId, companyId, name: NET_PAYABLE_ACCOUNT_NAME, isPosting: true, isActive: true, isArchived: false },
    select: { id: true },
  });
  if (!netPayable) throw badRequest("حساب «رواتب مستحقة» (التزام، حساب ترحيل) غير موجود في شجرة هذه الشركة — مطلوب لصافي الرواتب");

  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, tenantId, companyId },
    select: { id: true, accountId: true, departmentId: true, costCenterId: true, departmentRef: { select: { name: true } } },
  });
  const allocation = new Map<string, EmployeeAllocation>(employees.map((e) => [e.id, {
    departmentId: e.departmentId, departmentName: e.departmentRef?.name ?? null, costCenterId: e.costCenterId,
    netAccountId: mode === "perEmployee" ? e.accountId ?? netPayable.id : undefined,
  }]));

  const accountIds = [...new Set(components.flatMap((c) => [c.accountId, c.contraAccountId]).filter(Boolean))] as string[];
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, tenantId, companyId }, select: { id: true, type: true } });
  const accountTypeById = new Map(accounts.map((a) => [a.id, a.type as string]));

  return {
    mode,
    rows,
    components: new Map(components.map((c): [string, JournalComponent] => [c.id, { id: c.id, name: c.name, kind: c.kind, accountId: c.accountId, contraAccountId: c.contraAccountId, systemKey: c.systemKey }])),
    employees: allocation,
    accountTypeById,
    netPayableAccountId: netPayable.id,
    advanceByComponentId: new Map([...advanceByComponentId].map(([k, a]) => [k, { id: a.id, remainingBalance: Number(a.remainingBalance) }])),
  };
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

  const company = await prisma.company.findUniqueOrThrow({ where: { id: run.companyId }, select: { payrollTotalsFromMonth: true } });
  const postTotals = company.payrollTotalsFromMonth != null && run.month >= company.payrollTotalsFromMonth;
  const { lines: journalLines, advanceDeductions } = buildPayrollJournal(
    await resolveJournalContext(tenantId, run.companyId, run.employeeIds, rows, components, advanceByComponentId, postTotals ? "totals" : "perEmployee"),
  );

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

    return tx.payrollRun.update({ where: { id }, data: { status: "posted", postedSnapshot: JSON.parse(JSON.stringify({ components, rows })), journalEntryId: entry.id } });
  });
}

export async function unpostPayrollRun(tenantId: string, userId: string, id: string, pin: string) {
  const run = await prisma.payrollRun.findFirst({ where: { id, tenantId } });
  if (!run) throw notFound("كشف الرواتب غير موجود");
  if (run.status !== "posted") throw badRequest("كشف الرواتب ليس مرحّلاً أصلاً");

  // فك الترحيل يحذف القيد؛ قيد مرآة في شركة أخرى أو قيد عكس قائم يبقيان بعده بلا أصل ويُحتسَب أثرهما مرتين عند إعادة
  // الترحيل — فيُرفَض حتى يُعالَجا أولاً (قاعدة المرآة والعكس، CLAUDE.md 1).
  if (run.journalEntryId) {
    const entry = await prisma.journalEntry.findFirst({ where: { id: run.journalEntryId, tenantId }, select: { mirrorEntryId: true } });
    const reversal = await prisma.journalEntry.findFirst({ where: { tenantId, reversalOfEntryId: run.journalEntryId }, select: { id: true } });
    if (entry?.mirrorEntryId) throw badRequest("لقيد هذا الكشف قيد مرآة في شركة أخرى — احذف قيد المرآة أولاً ثم فك ترحيل الكشف");
    if (reversal) throw badRequest("قيد هذا الكشف معكوس بقيد آخر — فك ترحيل الكشف بعده يكرّر الأثر؛ احذف قيد العكس أولاً");
  }

  await assertValidUnlockPin(tenantId, pin, userId);

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
    const updated = await tx.payrollRun.update({ where: { id }, data: { status: "draft", postedSnapshot: Prisma.DbNull, journalEntryId: null } });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "PayrollRun", entityId: id });
    return updated;
  });
}


/** Only an unposted draft without supporting records may be removed. */
export async function deletePayrollRun(tenantId: string, id: string) {
  return prisma.$transaction(async tx => {
    const run = await tx.payrollRun.findFirst({ where: { id, tenantId } });
    if (!run) throw notFound("كشف الرواتب غير موجود");
    if (run.status !== "draft" || run.journalEntryId) throw badRequest("لا يمكن حذف مسير مرحّل");
    const attachments = await tx.attachment.count({ where: { tenantId, entityType: "payroll_run", entityId: id } });
    if (attachments) throw badRequest("أزل مرفقات المسودة قبل حذفها");
    const deleted = await tx.payrollRun.deleteMany({ where: { id, tenantId, status: "draft", journalEntryId: null, advanceDeductions: { none: {} } } });
    if (!deleted.count) throw badRequest("تعذر حذف المسودة؛ حدّث الصفحة وتحقق من حالتها");
    return { deleted: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
