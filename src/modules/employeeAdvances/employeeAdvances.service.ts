import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { ensureEmployeeReceivableAccount, getAdvancesParentId } from "../../lib/employeeReceivableAccount";
import { COUNTED_ENTRY_WHERE } from "../../lib/countedEntries";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";

const PAYMENT_ACCOUNT_NAME: Record<string, string> = {
  cash: "النقدية بالصندوق",
  bank: "البنك الأهلي - حساب تشغيلي",
};

function withComputed<T extends { amount: unknown; remainingBalance: unknown; monthlyInstallment?: unknown; status?: unknown }>(advance: T) {
  return {
    ...advance,
    repaidAmount: Number(advance.amount) - Number(advance.remainingBalance),
    // نشطة بلا قسط شهري: لا يخصمها كشف الرواتب، تنتظر قسطاً
    needsInstallment: advance.status === "active" && advance.monthlyInstallment == null && Number(advance.remainingBalance) > 0,
  };
}

export type RegisterEmployeeAdvanceInput = {
  companyId: string;
  employeeId: string;
  accountId: string;
  amount: number;
  monthlyInstallment?: number;
  startDate: Date;
  journalEntryId?: string;
  sourceJournalEntryLineId?: string;
};

/**
 * ينشئ سجل سلفة/عهدة موظف فقط — بلا أي قيد محاسبي خاص به (بنفس فلسفة registerFixedAssetTx،
 * Phase D). القيد (إن وُجد) مسؤولية المستدعي: createEmployeeAdvance أدناه يُنشئ قيد صرف مستقلاً
 * بعد استدعاء هذه الدالة مباشرة ضمن نفس المعاملة (مسار "شاشة السلف" المستقل)؛ لاحقاً، نافذة اختيار
 * حساب "عهدة/سلفة" داخل سطر قيد يومية عام (Phase F) ستستدعيها مع sourceJournalEntryLineId جاهزاً
 * بدل قيد مستقل. القسط الشهري (إن وُجد) يخصمه كشف الرواتب تلقائياً من السلفة نفسها.
 */
export async function registerEmployeeAdvanceTx(tx: Prisma.TransactionClient, tenantId: string, input: RegisterEmployeeAdvanceInput) {
  const employee = await tx.employee.findFirst({ where: { id: input.employeeId, tenantId, companyId: input.companyId } });
  if (!employee) throw badRequest("الموظف غير موجود ضمن هذه الشركة");

  const account = await tx.account.findFirst({ where: { id: input.accountId, tenantId, companyId: input.companyId } });
  if (!account) throw badRequest("الحساب المحاسبي المختار غير موجود ضمن شجرة هذه الشركة");
  if (!account.isPosting || !account.isActive || account.isArchived) throw badRequest("الحساب المحاسبي المختار ليس حساب ترحيل نشطاً");
  if (account.type !== "asset") throw badRequest("الحساب المحاسبي المختار ليس من نوع أصول");

  // القسط الشهري يُحسَب في كل كشف رواتب من السلفة نفسها (computeRun) — لا بند رواتب لكل سلفة بعد الآن (قرار المالك
  // 2026-11-01). سلف قديمة لها employeePayrollComponentId تبقى كما هي، وبنودها مستبعَدة من الحساب.
  const advance = await tx.employeeAdvance.create({
    data: {
      tenantId,
      companyId: input.companyId,
      employeeId: input.employeeId,
      accountId: input.accountId,
      amount: input.amount,
      monthlyInstallment: input.monthlyInstallment,
      remainingBalance: input.amount,
      startDate: input.startDate,
      status: "active",
      journalEntryId: input.journalEntryId,
      sourceJournalEntryLineId: input.sourceJournalEntryLineId,
    },
  });
  return advance;
}

export async function listEmployeeAdvances(tenantId: string, filters: { companyId?: string; employeeId?: string }) {
  const advances = await prisma.employeeAdvance.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, employeeId: filters.employeeId || undefined },
    include: { employee: { select: { id: true, name: true } }, account: { select: { id: true, code: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return advances.map(withComputed);
}

export async function createEmployeeAdvance(
  tenantId: string,
  userId: string,
  input: {
    companyId: string;
    employeeId: string;
    accountId?: string;
    amount: number;
    monthlyInstallment?: number;
    startDate: Date;
    paymentMethod: "cash" | "bank";
  },
) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, tenantId, companyId: input.companyId } });
  if (!employee) throw badRequest("الموظف غير موجود ضمن هذه الشركة");

  const creditAccountId = await getAccountIdByName(tenantId, input.companyId, PAYMENT_ACCOUNT_NAME[input.paymentMethod]);

  return prisma.$transaction(async (tx) => {
    // مع اختيار مجموعة ذمم الموظفين في إعدادات الرواتب: السلفة الجديدة تُقيَّد دائماً على حساب الموظف الفرعي (يُنشأ أول
    // مرة)؛ بدونها يبقى الحساب المختار في الطلب (السلوك السابق) — ولا يُقبَل طلب بلا حساب.
    const parentId = await getAdvancesParentId(tx, tenantId, input.companyId);
    const accountId = parentId ? await ensureEmployeeReceivableAccount(tx, tenantId, input.employeeId) : input.accountId;
    if (!accountId) throw badRequest("اختر الحساب المحاسبي الذي ستُسجَّل عليه هذه السلفة");
    const advance = await registerEmployeeAdvanceTx(tx, tenantId, { ...input, accountId });

    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.startDate,
      memo: `صرف سلفة موظف — ${employee.name}`,
      sourceModule: "manual",
      createdBy: userId,
      lines: [
        { accountId, employeeId: input.employeeId, employeeAdvanceId: advance.id, debit: input.amount, credit: 0 },
        { accountId: creditAccountId, debit: 0, credit: input.amount },
      ],
    });

    const updated = await tx.employeeAdvance.update({ where: { id: advance.id }, data: { journalEntryId: entry.id } });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: advance.id } });
    return withComputed(updated);
  });
}

/**
 * حذف سلفة قبل أي خصم فعلي منها (لتصحيح خطأ إدخال) — محمي برقم سري لأنه يحذف قيد الصرف المرتبط،
 * بنفس مبدأ removeFixedAsset. غير مسموح لو سُدِّد منها أي مبلغ عبر الرواتب بالفعل (استخدم فك ترحيل
 * تشغيل الرواتب المعني أولاً لإرجاع كل الأرصدة، ثم احذف).
 */
export async function removeEmployeeAdvance(tenantId: string, userId: string, id: string, pin: string) {
  const advance = await prisma.employeeAdvance.findFirst({ where: { id, tenantId } });
  if (!advance) throw notFound("السلفة غير موجودة");
  if (Number(advance.remainingBalance) !== Number(advance.amount)) {
    throw badRequest("لا يمكن حذف سلفة سُدِّد منها مبلغ بالفعل عبر الرواتب");
  }
  if (!advance.journalEntryId) throw badRequest("هذه السلفة غير مرتبطة بقيد صرف مستقل يمكن حذفه من هنا");

  await assertValidUnlockPin(tenantId, pin, userId);

  await prisma.$transaction(async (tx) => {
    await deleteJournalEntryTx(tx, advance.journalEntryId);
    // البند مخصَّص حصرياً لهذه السلفة (Phase E) — يُحذَف معها بدل تركه يتيماً؛ حذف EmployeeAdvance
    // نفسها أولاً يُزيل مرجعها لـ employeePayrollComponentId فيسمح بحذف الأخير بأمان.
    const employeePayrollComponentId = advance.employeePayrollComponentId;
    await tx.employeeAdvance.delete({ where: { id } });
    if (employeePayrollComponentId) {
      const ec = await tx.employeePayrollComponent.findUnique({ where: { id: employeePayrollComponentId } });
      if (ec) {
        await tx.employeePayrollComponent.delete({ where: { id: ec.id } });
        await tx.payrollComponent.delete({ where: { id: ec.componentId } });
      }
    }
    await writeUnpostAuditLogTx(tx, { tenantId, userId, companyId: advance.companyId, entityType: "EmployeeAdvance", entityId: id });
  });
}

/** تحديد/تعديل القسط الشهري لسلفة نشطة (للسلف «تحتاج قسطاً») — يسري على كشوف الرواتب التي لم تُرحَّل بعد، ومسجَّل في التدقيق */
export async function setAdvanceInstallment(tenantId: string, userId: string, id: string, monthlyInstallment: number) {
  const advance = await prisma.employeeAdvance.findFirst({ where: { id, tenantId } });
  if (!advance) throw notFound("السلفة غير موجودة");
  if (advance.status !== "active") throw badRequest("السلفة ليست نشطة");
  if (monthlyInstallment > Number(advance.remainingBalance)) throw badRequest("القسط الشهري لا يمكن أن يتجاوز الرصيد المتبقي للسلفة");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.employeeAdvance.update({ where: { id }, data: { monthlyInstallment } });
    await tx.auditLog.create({
      data: {
        tenantId, companyId: advance.companyId, userId, action: "employee_advance.installment_changed", entityType: "EmployeeAdvance", entityId: id,
        metadata: { before: advance.monthlyInstallment == null ? null : Number(advance.monthlyInstallment), after: monthlyInstallment },
      },
    });
    return withComputed(updated);
  });
}

/**
 * معاينة إعادة تصنيف السلف القائمة (للقراءة فقط — لا تُنشئ قيداً ولا حساباً ولا تغيّر أي سلفة): لكل سلفة نشطة رصيدها على
 * حساب غير حساب ذمة صاحبها، سطر دائن بالرصيد المتبقي على حسابها الحالي، ولكل موظف سطر مدين بمجموعها على حسابه الفرعي
 * (القائم، أو «سيُنشأ» باسمه تحت المجموعة المختارة). ومقارنة رصيد الدفتر لكل حساب قديم بمجموع الأرصدة المتبقية عليه،
 * ولكل موظف (أسطر الدفتر الموسومة به على ذلك الحساب)، مع ما على الحساب بلا وسم موظف.
 */
export async function previewAdvancesReclass(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة غير موجودة ضمن مستأجرك");
  const parentId = await getAdvancesParentId(prisma as unknown as Prisma.TransactionClient, tenantId, companyId);
  const parent = parentId ? await prisma.account.findFirst({ where: { id: parentId, tenantId, companyId }, select: { id: true, code: true, name: true } }) : null;

  const advances = await prisma.employeeAdvance.findMany({
    where: { tenantId, companyId, status: "active", remainingBalance: { gt: 0 } },
    include: { employee: { select: { id: true, name: true, receivableAccountId: true } }, account: { select: { id: true, code: true, name: true } } },
    orderBy: [{ employeeId: "asc" }, { startDate: "asc" }],
  });
  const toMove = advances.filter((a) => a.accountId !== a.employee.receivableAccountId);
  const receivableIds = [...new Set(toMove.map((a) => a.employee.receivableAccountId).filter(Boolean))] as string[];
  const receivables = new Map((await prisma.account.findMany({ where: { id: { in: receivableIds }, tenantId, companyId }, select: { id: true, code: true, name: true } })).map((a) => [a.id, a]));

  type Line = { accountId: string | null; accountCode: string | null; accountName: string; willBeCreated?: boolean; employeeId: string; employeeAdvanceId?: string; debit: number; credit: number };
  const lines: Line[] = [];
  const byEmployee = new Map<string, typeof toMove>();
  for (const a of toMove) byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) || []), a]);
  for (const [employeeId, list] of byEmployee) {
    const employee = list[0].employee;
    const target = employee.receivableAccountId ? receivables.get(employee.receivableAccountId) : null;
    const total = Math.round(list.reduce((s, a) => s + Number(a.remainingBalance), 0) * 100) / 100;
    lines.push({ accountId: target?.id ?? null, accountCode: target?.code ?? null, accountName: target?.name ?? employee.name, willBeCreated: !target, employeeId, debit: total, credit: 0 });
    for (const a of list) {
      lines.push({ accountId: a.accountId, accountCode: a.account.code, accountName: a.account.name, employeeId, employeeAdvanceId: a.id, debit: 0, credit: Number(a.remainingBalance) });
    }
  }

  // مطابقة الدفتر: لكل حساب قديم، رصيده (مدين − دائن) من القيود المحتسبة، مقابل مجموع الأرصدة المتبقية للسلف عليه
  const oldAccountIds = [...new Set(toMove.map((a) => a.accountId))];
  const counted = { AND: [COUNTED_ENTRY_WHERE], tenantId, companyId };
  const glByAccountEmployee = await prisma.journalEntryLine.groupBy({
    by: ["accountId", "employeeId"],
    where: { accountId: { in: oldAccountIds }, journalEntry: counted },
    _sum: { debit: true, credit: true },
  });
  const net = (r: { _sum: { debit: unknown; credit: unknown } }) => Math.round((Number(r._sum.debit || 0) - Number(r._sum.credit || 0)) * 100) / 100;
  const allActiveOnOld = await prisma.employeeAdvance.findMany({
    where: { tenantId, companyId, status: "active", accountId: { in: oldAccountIds } },
    include: { employee: { select: { id: true, name: true } } },
  });
  const accounts = oldAccountIds.map((accountId) => {
    const account = toMove.find((a) => a.accountId === accountId)!.account;
    const glRows = glByAccountEmployee.filter((r) => r.accountId === accountId);
    const glBalance = Math.round(glRows.reduce((s, r) => s + net(r), 0) * 100) / 100;
    const onAccount = allActiveOnOld.filter((a) => a.accountId === accountId);
    const advancesTotal = Math.round(onAccount.reduce((s, a) => s + Number(a.remainingBalance), 0) * 100) / 100;
    const employeeIds = [...new Set([...onAccount.map((a) => a.employeeId), ...glRows.map((r) => r.employeeId).filter(Boolean) as string[]])];
    const employees = employeeIds.map((employeeId) => {
      const gl = net({ _sum: { debit: glRows.filter((r) => r.employeeId === employeeId).reduce((s, r) => s + Number(r._sum.debit || 0), 0), credit: glRows.filter((r) => r.employeeId === employeeId).reduce((s, r) => s + Number(r._sum.credit || 0), 0) } });
      const remaining = Math.round(onAccount.filter((a) => a.employeeId === employeeId).reduce((s, a) => s + Number(a.remainingBalance), 0) * 100) / 100;
      const name = onAccount.find((a) => a.employeeId === employeeId)?.employee.name ?? null;
      return { employeeId, name, glBalance: gl, advancesRemaining: remaining, difference: Math.round((gl - remaining) * 100) / 100 };
    });
    const untagged = glRows.filter((r) => !r.employeeId).reduce((s, r) => s + net(r), 0);
    return {
      accountId, code: account.code, name: account.name, glBalance, advancesRemaining: advancesTotal,
      difference: Math.round((glBalance - advancesTotal) * 100) / 100,
      untaggedGlBalance: Math.round(untagged * 100) / 100,
      employees,
    };
  });

  return {
    posted: false,
    parent,
    note: "معاينة فقط — لم يُنشأ قيد ولا حساب ولم تتغيّر أي سلفة",
    lines,
    totals: { debit: Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100, credit: Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100 },
    accounts,
  };
}
