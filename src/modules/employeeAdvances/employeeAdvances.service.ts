import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx, deleteJournalEntryTx, assertValidUnlockPin, writeUnpostAuditLogTx } from "../../lib/journalPosting";

const PAYMENT_ACCOUNT_NAME: Record<string, string> = {
  cash: "النقدية بالصندوق",
  bank: "البنك الأهلي - حساب تشغيلي",
};

function withComputed<T extends { amount: unknown; remainingBalance: unknown }>(advance: T) {
  return { ...advance, repaidAmount: Number(advance.amount) - Number(advance.remainingBalance) };
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
 * بدل قيد مستقل. لو monthlyInstallment محدَّدة، تُنشئ بند راتب مخصَّص لهذه السلفة تحديداً (خصم ثابت،
 * لا يُشارَك مع أي سلفة أخرى لنفس الموظف — انظر تعليق التصميم في schema.prisma).
 */
export async function registerEmployeeAdvanceTx(tx: Prisma.TransactionClient, tenantId: string, input: RegisterEmployeeAdvanceInput) {
  const employee = await tx.employee.findFirst({ where: { id: input.employeeId, tenantId, companyId: input.companyId } });
  if (!employee) throw badRequest("الموظف غير موجود ضمن هذه الشركة");

  const account = await tx.account.findFirst({ where: { id: input.accountId, tenantId, companyId: input.companyId } });
  if (!account) throw badRequest("الحساب المحاسبي المختار غير موجود ضمن شجرة هذه الشركة");
  if (!account.isPosting || !account.isActive || account.isArchived) throw badRequest("الحساب المحاسبي المختار ليس حساب ترحيل نشطاً");
  if (account.type !== "asset") throw badRequest("الحساب المحاسبي المختار ليس من نوع أصول");

  let employeePayrollComponentId: string | undefined;
  if (input.monthlyInstallment) {
    // الخصم الشهري التلقائي يحتاج نظام بنود الرواتب الحقيقي (بعد تشغيل backfillPayrollComponents.ts)
    // — إنشاء PayrollComponent هنا على شركة لم تُهاجَر بعد يقلب resolveEffectiveComponents فوراً من
    // المنطق القديم المصنَّع (12 بنداً مطابقاً للأعمدة القديمة) إلى وضع "محفوظ" بهذا البند اليتيم
    // وحده، فتختفي كل بنود الراتب الأخرى (الأساسي والبدلات...) من كل تشغيلات الرواتب القادمة —
    // خطأ جسيم يُمنَع هنا صراحة بدل اكتشافه لاحقاً في كشف رواتب فارغ.
    const hasPersistedComponents = (await tx.payrollComponent.count({ where: { tenantId, companyId: input.companyId } })) > 0;
    if (!hasPersistedComponents) {
      throw badRequest("يجب تشغيل ترحيل بنود الرواتب لهذه الشركة أولاً قبل ربط سلفة بخصم شهري تلقائي — يمكنك تسجيل السلفة بلا قسط شهري (سداد يدوي) حتى ذلك الحين");
    }
    const component = await tx.payrollComponent.create({
      data: {
        tenantId,
        companyId: input.companyId,
        name: `قسط سلفة — ${employee.name} (${input.startDate.toISOString().slice(0, 10)})`,
        kind: "deduction",
        accountId: input.accountId,
        calcMethod: "fixed",
        // بلا تسويات شهرية يدوية وبلا تناسب جزء شهر — القيمة الفعلية تُحدَّد آلياً كل شهر
        // (الأقل بين القسط المتبقي والرصيد المتبقي) عبر منطق postPayrollRun وحده.
        allowsMonthlyAdjustments: false,
        prorateOnPartialMonth: false,
        appliesByDefault: false,
        isSystem: false,
        isActive: true,
      },
    });
    const employeePayrollComponent = await tx.employeePayrollComponent.create({
      data: { tenantId, employeeId: input.employeeId, componentId: component.id, fixedValue: input.monthlyInstallment, isActive: true },
    });
    employeePayrollComponentId = employeePayrollComponent.id;
  }

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
      employeePayrollComponentId,
      journalEntryId: input.journalEntryId,
      sourceJournalEntryLineId: input.sourceJournalEntryLineId,
    },
  });
  return advance;
}

export async function listEmployeeAdvances(tenantId: string, filters: { companyId?: string; employeeId?: string }) {
  const advances = await prisma.employeeAdvance.findMany({
    where: { tenantId, companyId: filters.companyId || undefined, employeeId: filters.employeeId || undefined },
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
    accountId: string;
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
    const advance = await registerEmployeeAdvanceTx(tx, tenantId, input);

    const entry = await createJournalEntryTx(tx, {
      tenantId,
      companyId: input.companyId,
      date: input.startDate,
      memo: `صرف سلفة موظف — ${employee.name}`,
      sourceModule: "manual",
      createdBy: userId,
      lines: [
        { accountId: input.accountId, employeeId: input.employeeId, employeeAdvanceId: advance.id, department: "الموارد البشرية", debit: input.amount, credit: 0 },
        { accountId: creditAccountId, department: "المالية والحسابات", debit: 0, credit: input.amount },
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

  await assertValidUnlockPin(tenantId, pin);

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
    await writeUnpostAuditLogTx(tx, { tenantId, userId, entityType: "EmployeeAdvance", entityId: id });
  });
}
