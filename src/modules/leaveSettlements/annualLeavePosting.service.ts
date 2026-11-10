/**
 * ترحيل مسودة الإجازة السنوية (قرار المالك 2026-11-10):
 * - الراتب: بنود الكشف نفسها عبر buildPayrollJournal (الأساسي على حساب رواتب قسم الموظف، والتأمينات على حسابها…).
 * - بدل الإجازة: مدين حساب الإجازات. الإضافات الأخرى: مدين حساب البدلات الأخرى. التذكرة: مدين حساب التذاكر.
 * - الصافي كله: دائن حساب الموظف الشخصي (Employee.accountId)، ومنه يُصرف لاحقاً من شاشة التسويات (disburseLeaveSettlement).
 * معاينة القيد والترحيل يستدعيان buildAnnualLeaveJournal نفسها، فما يُعرض قبل الترحيل هو ما يُرحَّل.
 */
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { createJournalEntryTx } from "../../lib/journalPosting";
import { buildPayrollJournal, NET_PAYABLE_ACCOUNT_NAME, UNASSIGNED_DEPARTMENT_LABEL, type JournalComponent, type PayrollJournalLine } from "../payrollRuns/payrollJournal";
import { computeAnnualLeave, findDraft } from "./annualLeaveDraft.service";
import { roundMoney } from "./annualLeaveCalculation";
import type { AnnualLeaveDraftInput } from "./annualLeaveDraft.schemas";

export interface PostingAccounts { leaveAccountId?: string | null; additionsAccountId?: string | null; ticketAccountId?: string | null }

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const BLOCKED_SALARY_KEYS = new Set(["advance", "violation"]);

export async function buildAnnualLeaveJournal(tenantId: string, draftId: string, accounts: PostingAccounts) {
  const draft = await findDraft(tenantId, draftId);
  if (draft.status === "posted") throw badRequest("مسودة الإجازة مرحّلة بالفعل");
  const input = draft.request as unknown as AnnualLeaveDraftInput;
  const { snapshot, emp, components, row, includeSalary } = await computeAnnualLeave(tenantId, input);
  const stored = draft.snapshot as unknown as { net: number };
  if (roundMoney(stored.net) !== snapshot.net) {
    throw badRequest("تغيّرت بيانات الموظف أو رصيده منذ حفظ المسودة — افتح المسودة واحفظها من جديد قبل الترحيل");
  }
  if (snapshot.warnings.includes("on_leave")) throw badRequest("الموظف في إجازة بالفعل");
  if (snapshot.warnings.includes("negative_salary")) throw badRequest("صافي راتب الشهر سالب — راجع الخصومات قبل الترحيل");
  if (snapshot.net <= 0) throw badRequest("صافي المبلغ المستحق يجب أن يكون أكبر من صفر");
  if (!emp.accountId) throw badRequest("الموظف بلا حساب شخصي في شجرة الحسابات — اربطه من ملف الموظف قبل الترحيل");
  const employeeAccountId = emp.accountId;

  const [settings, department, netPayable] = await Promise.all([
    prisma.payrollSettings.findUnique({ where: { companyId: emp.companyId } }),
    emp.departmentId ? prisma.department.findFirst({ where: { id: emp.departmentId, tenantId }, select: { id: true, name: true, salaryExpenseAccountId: true } }) : null,
    prisma.account.findFirst({ where: { tenantId, companyId: emp.companyId, name: NET_PAYABLE_ACCOUNT_NAME }, select: { id: true } }),
  ]);
  const otherAllow = components.find((c) => c.systemKey === "otherAllow");
  const chosen = {
    leaveAccountId: accounts.leaveAccountId || settings?.leaveExpenseAccountId || null,
    additionsAccountId: accounts.additionsAccountId || settings?.leaveAdditionsAccountId || otherAllow?.accountId || null,
    ticketAccountId: accounts.ticketAccountId || settings?.leaveTicketAccountId || null,
  };

  const lines: PayrollJournalLine[] = [];
  if (includeSalary && row) {
    const used = Object.entries(row.componentValues).filter(([, v]) => v);
    const blocked = components.find((c) => c.systemKey && BLOCKED_SALARY_KEYS.has(c.systemKey) && used.some(([id]) => id === c.id));
    if (blocked || (row.advanceInstallments || []).some((a) => round2(a.amount) > 0)) {
      throw badRequest("على الموظف خصم سلفة أو مخالفة في راتب هذا الشهر — يُرحَّل من كشف الرواتب لا من مسودة الإجازة");
    }
    const ids = [...new Set(components.flatMap((c) => [c.accountId, c.contraAccountId]).concat(department?.salaryExpenseAccountId).filter(Boolean))] as string[];
    const types = await prisma.account.findMany({ where: { id: { in: ids }, tenantId, companyId: emp.companyId }, select: { id: true, type: true } });
    const salary = buildPayrollJournal({
      mode: "perEmployee",
      rows: [{ employeeId: emp.id, employeeName: emp.name, componentValues: row.componentValues, advanceInstallments: [] }],
      components: new Map(components.map((c): [string, JournalComponent] => [c.id, { id: c.id, name: c.name, kind: c.kind, accountId: c.accountId, contraAccountId: c.contraAccountId, systemKey: c.systemKey }])),
      employees: new Map([[emp.id, { departmentId: emp.departmentId, departmentName: department?.name ?? null, costCenterId: emp.costCenterId,
        salaryExpenseAccountId: department?.salaryExpenseAccountId ?? null, netAccountId: employeeAccountId }]]),
      accountTypeById: new Map(types.map((a) => [a.id, a.type as string])),
      netPayableAccountId: netPayable?.id || employeeAccountId,
    });
    lines.push(...salary.lines);
  }

  const expenseIds = [chosen.leaveAccountId, chosen.additionsAccountId, chosen.ticketAccountId].filter(Boolean) as string[];
  const expenseTypes = new Map((await prisma.account.findMany({ where: { id: { in: expenseIds }, tenantId, companyId: emp.companyId }, select: { id: true, type: true } })).map((a) => [a.id, a.type as string]));
  const debit = (accountId: string | null, amount: number, description: string, missing: string) => {
    const value = round2(amount);
    if (!value) return;
    if (!accountId) throw badRequest(missing);
    if (!expenseTypes.has(accountId)) throw badRequest("أحد حسابات القيد لا ينتمي إلى شجرة الشركة أو ليس حساب ترحيل نشطاً");
    const tagged = expenseTypes.get(accountId) === "expense";
    lines.push({ accountId, debit: value, credit: 0, lineDescription: description, employeeId: emp.id,
      department: tagged ? department?.name || UNASSIGNED_DEPARTMENT_LABEL : null, departmentId: tagged ? emp.departmentId : null, costCenterId: tagged ? emp.costCenterId : null });
  };
  debit(chosen.leaveAccountId, snapshot.balance.payAmount, `بدل إجازة ${snapshot.balance.payDays} يوم`, "اختر حساب مصروف الإجازات");
  debit(chosen.additionsAccountId, input.otherAdditions, input.additionsReason || "إضافات أخرى", "اختر حساب البدلات الأخرى للإضافات");
  debit(chosen.ticketAccountId, input.ticketAmount, "تذكرة سفر", "اختر حساب مصروف تذاكر السفر");

  // كل ما يخص الموظف (صافي الراتب + الإجازة + الإضافات + التذكرة) سطر دائن واحد على حسابه الشخصي
  const others = lines.filter((l) => l.accountId !== employeeAccountId);
  const net = round2(others.reduce((s, l) => s + l.debit - l.credit, 0));
  // كشف الرواتب يقرّب كل بند للهللة قبل الجمع واللقطة تقرّب الصافي مرة واحدة؛ فرق أكثر من هللتين يعني بنداً لم يُرحَّل
  if (Math.abs(net - snapshot.net) > 0.02) throw badRequest("قيد الإجازة لا يطابق صافي المسودة — راجع حسابات بنود الراتب");
  const journalLines = [...others, { accountId: employeeAccountId, debit: 0, credit: net, lineDescription: `صافي مستحقات الإجازة — ${emp.name}`,
    employeeId: emp.id, department: null, departmentId: null, costCenterId: null }];

  const names = new Map((await prisma.account.findMany({ where: { id: { in: [...new Set(journalLines.map((l) => l.accountId))] }, tenantId, companyId: emp.companyId },
    select: { id: true, code: true, name: true, nameEn: true } })).map((a) => [a.id, a]));
  return { draft, input, snapshot, emp, chosen, net, lines: journalLines,
    preview: journalLines.map((l) => ({ ...l, account: names.get(l.accountId) || null })),
    memo: input.otherAdditions > 0
      ? `مستحقات إجازة — ${emp.name} — إضافات ${input.otherAdditions.toFixed(2)}: ${input.additionsReason}`
      : `مستحقات إجازة — ${emp.name}` };
}

export async function previewAnnualLeaveJournal(tenantId: string, draftId: string, accounts: PostingAccounts) {
  const { chosen, preview, memo, snapshot, draft, net } = await buildAnnualLeaveJournal(tenantId, draftId, accounts);
  return { companyId: draft.companyId, accounts: chosen, memo, date: snapshot.request.leaveStartDate, net, lines: preview };
}

export async function postAnnualLeaveDraft(tenantId: string, userId: string, draftId: string, accounts: PostingAccounts) {
  const { draft, input, snapshot, emp, chosen, lines, memo, net } = await buildAnnualLeaveJournal(tenantId, draftId, accounts);
  const balance = snapshot.balance;
  return prisma.$transaction(async (tx) => {
    // يمنع ترحيلين متزامنين للمسودة نفسها: التحديث المشروط يفشل للثاني
    const claimed = await tx.annualLeaveDraft.updateMany({ where: { id: draft.id, tenantId, status: "draft" }, data: { status: "posted", postedBy: userId, postedAt: new Date() } });
    if (claimed.count !== 1) throw badRequest("مسودة الإجازة مرحّلة بالفعل");
    const entry = await createJournalEntryTx(tx, { tenantId, companyId: emp.companyId, date: new Date(input.leaveStartDate), memo,
      sourceModule: "leave_settlement", createdBy: userId, lines });
    const settlement = await tx.leaveSettlement.create({ data: {
      tenantId, employeeId: emp.id, leaveStartDate: new Date(input.leaveStartDate), leaveEndDate: input.leaveEndDate ? new Date(input.leaveEndDate) : null,
      settlementType: "actual_leave", leaveDays: balance.payDays, usedLeaveDaysBefore: 0, remainingLeaveDays: balance.remainingDays,
      leaveBalanceAmount: balance.availableAmount, leavePayAmount: balance.payAmount, monthAmount: snapshot.salary.net, daysWorked: snapshot.salary.days,
      bonuses: input.otherAdditions, deductions: 0, ticketAmount: input.ticketAmount, visaAmount: 0, accruedDays: balance.availableDays,
      netAmount: net, journalEntryId: entry.id, status: "calculated",
    } });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: settlement.id } });
    await tx.employee.update({ where: { id: emp.id }, data: { leaveStatus: "onLeave" } });
    await tx.payrollSettings.updateMany({ where: { companyId: emp.companyId, tenantId }, data: {
      leaveExpenseAccountId: chosen.leaveAccountId, leaveAdditionsAccountId: chosen.additionsAccountId, leaveTicketAccountId: chosen.ticketAccountId } });
    return tx.annualLeaveDraft.update({ where: { id: draft.id }, data: { journalEntryId: entry.id, leaveSettlementId: settlement.id } });
  });
}
