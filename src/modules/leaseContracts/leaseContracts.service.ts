import { LeasePaymentStatus, LeaseVatMode, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";
import { assertValidUnlockPin, createJournalEntryTx, deleteJournalEntryTx, recomputeEntryTotal, reserveEntryNumber, writeUnpostAuditLogTx, type PostingLine } from "../../lib/journalPosting";
import { INPUT_VAT_ACCOUNT_NAME } from "../../lib/vatAccounts";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { companyVatRatePercent } from "../../lib/companyVat";
import { env } from "../../config/env";
import { buildLeaseReminderEmail, hasLeaseAlerts } from "../../lib/leaseReminderEmail";
import { sendLeaseReminderEmail } from "../../lib/mailer";
import type { Lang } from "../../lib/i18n/translate";
import { resolveRecipientEmails } from "../reportSchedules/reportSchedules.service";
import { riyadhCalendarDay } from "../../lib/riyadhDate";
import { roundMoney, sumMoney } from "../../lib/money";
import { addDays, addMonths, amortizationPlan, amortizedThrough, dateToDay, dayToDate, daysBetween, generateInstallments, isDateOnly, isMonthOnly, monthEndDay, noticeDeadline, splitLeaseVat } from "../../lib/leaseSchedule";

/**
 * موديول الإيجارات — عقود الإيجار، جدول دفعاتها، تأكيد السداد، وإطفاء المصروف شهرياً.
 *
 * المعالجة المحاسبية (إيجار مدفوع مقدماً + إطفاء شهري):
 *   - تأكيد سداد دفعة ← قيد بتاريخ السداد: مدين «إيجار مدفوع مقدماً» بالصافي + مدين «ضريبة المدخلات» بضريبة الدفعة (عقد شامل
 *     الضريبة فقط) / دائن حساب البنك بالإجمالي. مصدره lease_payment.
 *   - إطفاء شهر ← قيد واحد للشركة بتاريخ آخر يوم في الشهر: لكل دفعة مسدَّدة يغطي الشهر جزءاً من فترتها، مدين مصروف الإيجار /
 *     دائن «إيجار مدفوع مقدماً» بنصيب الشهر، موسومين بمركز تكلفة العقد. مصدره lease_amortization. النصيب تراكمي: ما يجب أن يكون
 *     قد أُطفئ حتى نهاية الشهر ناقص ما أُطفئ فعلاً، فالدفعة التي تُسدَّد متأخرة تلحق أشهرها الفائتة في أول إطفاء بعد سدادها.
 *   - دفعة «سماح» (waived) لا قيد لها ولا إطفاء. دفعة postedExternally سُدِّدت وقُيِّدت خارج الموديول: بلا قيد سداد هنا، وتُطفأ
 *     (رصيدها قائم في «المدفوع مقدماً» من قيدها الأصلي) ابتداءً من amortizeFromMonth — ما قبله من فترتها صُرف في الدفاتر قبل
 *     بدء استخدام الموديول فلا يُلحَق، وإلا تكرر مصروفه.
 *
 * القيدان لا يُعكَسان ولا يُفَك ترحيلهما ولا يُعدَّلان ولا يُنشأ لهما قيد مرآة من شاشة القيود (assertNotStationShiftEntry في
 * journalEntries.service.ts): عكس السداد وإزالة الإطفاء من هذا الموديول فقط، فلا يبقى جدول الدفعات «مسدَّداً» وقيده زال.
 */

export const LEASE_PREPAID_ACCOUNT_NAME = "إيجارات مدفوعة مقدماً";
export const LEASE_EXPENSE_ACCOUNT_NAME = "إيجار مواقع/فروع";

export const LEASE_PREPAID_ACCOUNT_MISSING = "لم يُحدَّد حساب «إيجار مدفوع مقدماً» لهذا العقد ولا يوجد حساب «إيجارات مدفوعة مقدماً» في شجرة الشركة — حدّد الحساب في بيانات العقد";
export const LEASE_EXPENSE_ACCOUNT_MISSING = "لم يُحدَّد حساب مصروف الإيجار لهذا العقد ولا يوجد حساب «إيجار مواقع/فروع» في شجرة الشركة — حدّد الحساب في بيانات العقد";
export const LEASE_PAYMENT_NOT_DUE = "هذه الدفعة ليست بانتظار السداد";
export const LEASE_PAYMENT_AMORTIZED = "أُطفئ جزء من هذه الدفعة في إطفاء شهري مرحَّل — أزل إطفاء الأشهر التي تشملها أولاً";
export const LEASE_RUN_NOT_LATEST = "لا يُزال إلا آخر شهر إطفاء مرحَّل للشركة — أزل الأشهر الأحدث أولاً";
export const LEASE_RUN_EXISTS = "تم ترحيل إطفاء الإيجارات لهذا الشهر مسبقاً لهذه الشركة";
export const LEASE_RUN_OUT_OF_ORDER = "يوجد إطفاء مرحَّل لشهر أحدث — لا يُرحَّل شهر أقدم بعده";
export const LEASE_NOTHING_TO_AMORTIZE = "لا يوجد ما يُطفأ في هذا الشهر: لا دفعات مسدَّدة تغطيه";

const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const day = (date: Date | null | undefined) => (date ? dateToDay(date) : null);
const trimmed = (v: string | null | undefined) => v?.trim() || null;

type Db = Prisma.TransactionClient | typeof prisma;

async function companyOrThrow(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  return company;
}

async function assertPostingAccount(tenantId: string, companyId: string, accountId: string | null | undefined, message: string) {
  if (!accountId) return;
  const account = await prisma.account.findFirst({
    where: { id: accountId, tenantId, companyId, isPosting: true, isActive: true, isArchived: false },
    select: { id: true },
  });
  if (!account) throw badRequest(message);
}

async function assertCostCenter(tenantId: string, companyId: string, costCenterId: string | null | undefined) {
  if (!costCenterId) return;
  // مركز تكلفة الشركة نفسها، أو مركز مشترك على مستوى المستأجر (companyId فارغ) كما تعرضه شاشة مراكز التكلفة
  const costCenter = await prisma.costCenter.findFirst({ where: { id: costCenterId, tenantId, OR: [{ companyId }, { companyId: null }] }, select: { id: true } });
  if (!costCenter) throw badRequest("مركز التكلفة غير موجود ضمن هذه الشركة");
}

// ---------------------------------------------------------------------------
// العقود
// ---------------------------------------------------------------------------

export interface ContractInput {
  companyId: string;
  title: string;
  counterparty?: string | null;
  monthlyRent?: number | null;
  startDate: Date;
  endDate: Date;
  notes?: string | null;
  costCenterId?: string | null;
  vatMode?: LeaseVatMode;
  paymentAmount?: number | null;
  paymentEveryMonths?: number | null;
  firstDueDate?: Date | null;
  expenseAccountId?: string | null;
  prepaidAccountId?: string | null;
  isActive?: boolean;
  signedOn?: Date | null;
  contractNumber?: string | null;
  contractValue?: number | null;
  depositAmount?: number | null;
  customTerms?: string | null;
  autoRenew?: boolean;
  noticeDays?: number | null;
  lessorDetails?: Record<string, string | null | undefined> | null;
  propertyDetails?: Record<string, string | null | undefined> | null;
}

/** عمود Json اختياري: null الصريح يمسح العمود (DbNull)، وغير المُرسَل لا يمسّه. المفاتيح الفارغة تُحذف. */
function jsonColumn(value: Record<string, string | null | undefined> | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  const kept = Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "string" && v.trim() !== "").map(([k, v]) => [k, (v as string).trim()]));
  return Object.keys(kept).length > 0 ? (kept as Prisma.InputJsonObject) : Prisma.DbNull;
}

function contractData<T extends Partial<ContractInput>>(input: T) {
  const { lessorDetails, propertyDetails, ...rest } = input;
  return { ...rest, lessorDetails: jsonColumn(lessorDetails), propertyDetails: jsonColumn(propertyDetails) };
}

async function assertContractReferences(tenantId: string, companyId: string, input: Partial<ContractInput>) {
  await assertCostCenter(tenantId, companyId, input.costCenterId);
  await assertPostingAccount(tenantId, companyId, input.expenseAccountId, "حساب مصروف الإيجار يجب أن يكون حساب ترحيل نشطاً من نفس الشركة");
  await assertPostingAccount(tenantId, companyId, input.prepaidAccountId, "حساب الإيجار المدفوع مقدماً يجب أن يكون حساب ترحيل نشطاً من نفس الشركة");
}

export async function listLeaseContracts(tenantId: string, companyId?: string) {
  return prisma.leaseContract.findMany({
    where: { tenantId, companyId: companyId || undefined },
    orderBy: { endDate: "asc" },
  });
}

export async function createLeaseContract(tenantId: string, input: ContractInput) {
  await companyOrThrow(tenantId, input.companyId);
  if (input.endDate < input.startDate) throw badRequest("تاريخ نهاية العقد يسبق تاريخ بدايته");
  await assertContractReferences(tenantId, input.companyId, input);
  return prisma.leaseContract.create({ data: { ...contractData(input), tenantId } });
}

export async function updateLeaseContract(tenantId: string, id: string, input: Partial<ContractInput>) {
  const existing = await prisma.leaseContract.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("عقد الإيجار غير موجود");
  if (input.companyId && input.companyId !== existing.companyId) throw badRequest("لا تُنقَل شركة عقد الإيجار بعد إنشائه");
  const startDate = input.startDate ?? existing.startDate;
  const endDate = input.endDate ?? existing.endDate;
  if (endDate < startDate) throw badRequest("تاريخ نهاية العقد يسبق تاريخ بدايته");
  await assertContractReferences(tenantId, existing.companyId, input);
  const { companyId: _companyId, ...data } = input;
  return prisma.leaseContract.update({ where: { id: existing.id }, data: contractData(data) });
}

export async function deleteLeaseContract(tenantId: string, id: string) {
  const existing = await prisma.leaseContract.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("عقد الإيجار غير موجود");
  const settled = await prisma.leasePayment.count({ where: { tenantId, leaseContractId: id, status: "paid" } });
  if (settled > 0) throw badRequest("لهذا العقد دفعات مسدَّدة — لا يُحذف. أوقف العقد بدل حذفه، أو اعكس سداد دفعاته أولاً");
  // الدفعات غير المسدَّدة (due/waived) تُحذف مع العقد (onDelete: Cascade) — لا قيد لها ولا إطفاء
  await prisma.leaseContract.delete({ where: { id: existing.id } });
}

/** يضبط حسابَي الترحيل لعقود الشركة دفعة واحدة (كل العقود، أو التي لا حساب لها فقط). */
export async function applyLeaseAccounts(tenantId: string, input: { companyId: string; expenseAccountId?: string | null; prepaidAccountId?: string | null; onlyMissing?: boolean }) {
  await companyOrThrow(tenantId, input.companyId);
  await assertContractReferences(tenantId, input.companyId, input);
  let updated = 0;
  if (input.expenseAccountId) {
    const r = await prisma.leaseContract.updateMany({
      where: { tenantId, companyId: input.companyId, ...(input.onlyMissing ? { expenseAccountId: null } : {}) },
      data: { expenseAccountId: input.expenseAccountId },
    });
    updated = Math.max(updated, r.count);
  }
  if (input.prepaidAccountId) {
    const r = await prisma.leaseContract.updateMany({
      where: { tenantId, companyId: input.companyId, ...(input.onlyMissing ? { prepaidAccountId: null } : {}) },
      data: { prepaidAccountId: input.prepaidAccountId },
    });
    updated = Math.max(updated, r.count);
  }
  return { updated };
}

// ---------------------------------------------------------------------------
// جدول الدفعات
// ---------------------------------------------------------------------------

export interface PaymentInput {
  dueDate: string;
  periodFrom: string;
  periodTo: string;
  amount: number;
  status?: "due" | "waived";
  note?: string | null;
}

function assertPaymentDates(input: { dueDate: string; periodFrom: string; periodTo: string }) {
  if (!isDateOnly(input.dueDate) || !isDateOnly(input.periodFrom) || !isDateOnly(input.periodTo)) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
  if (input.periodFrom > input.periodTo) throw badRequest("بداية فترة الدفعة بعد نهايتها");
}

async function contractOrThrow(tenantId: string, contractId: string) {
  const contract = await prisma.leaseContract.findFirst({ where: { id: contractId, tenantId } });
  if (!contract) throw notFound("عقد الإيجار غير موجود");
  return contract;
}

function paymentData(input: Pick<PaymentInput, "dueDate" | "periodFrom" | "periodTo" | "amount">, vatMode: LeaseVatMode, ratePercent: number) {
  const split = splitLeaseVat(input.amount, vatMode, ratePercent);
  return {
    dueDate: dayToDate(input.dueDate),
    periodFrom: dayToDate(input.periodFrom),
    periodTo: dayToDate(input.periodTo),
    amount: d(split.amount),
    vatAmount: d(split.vatAmount),
    netAmount: d(split.netAmount),
  };
}

export async function createLeasePayment(tenantId: string, contractId: string, input: PaymentInput) {
  const contract = await contractOrThrow(tenantId, contractId);
  assertPaymentDates(input);
  if (!(input.amount > 0)) throw badRequest("مبلغ الدفعة يجب أن يكون أكبر من صفر");
  const rate = await companyVatRatePercent(tenantId, contract.companyId);
  return prisma.leasePayment.create({
    data: {
      tenantId, companyId: contract.companyId, leaseContractId: contract.id,
      ...paymentData(input, contract.vatMode, rate),
      status: input.status ?? "due", note: trimmed(input.note),
    },
  });
}

async function paymentOrThrow(tenantId: string, paymentId: string) {
  const payment = await prisma.leasePayment.findFirst({ where: { id: paymentId, tenantId }, include: { leaseContract: true } });
  if (!payment) throw notFound("دفعة الإيجار غير موجودة");
  return payment;
}

/** تعديل دفعة لم تُسدَّد (مبلغ/تواريخ/ملاحظة، أو تحويلها «سماح» والعكس). المسدَّدة تُعكَس أولاً. */
export async function updateLeasePayment(tenantId: string, paymentId: string, input: Partial<PaymentInput>) {
  const payment = await paymentOrThrow(tenantId, paymentId);
  if (payment.status === "paid") throw badRequest("الدفعة مسدَّدة — اعكس سدادها قبل تعديلها");
  const merged: PaymentInput = {
    dueDate: input.dueDate ?? dateToDay(payment.dueDate),
    periodFrom: input.periodFrom ?? dateToDay(payment.periodFrom),
    periodTo: input.periodTo ?? dateToDay(payment.periodTo),
    amount: input.amount ?? Number(payment.amount),
  };
  assertPaymentDates(merged);
  if (!(merged.amount > 0)) throw badRequest("مبلغ الدفعة يجب أن يكون أكبر من صفر");
  const rate = await companyVatRatePercent(tenantId, payment.companyId);
  return prisma.leasePayment.update({
    where: { id: payment.id },
    data: {
      ...paymentData(merged, payment.leaseContract.vatMode, rate),
      ...(input.status ? { status: input.status } : {}),
      ...(input.note !== undefined ? { note: trimmed(input.note) } : {}),
    },
  });
}

export async function deleteLeasePayment(tenantId: string, paymentId: string) {
  const payment = await paymentOrThrow(tenantId, paymentId);
  if (payment.status === "paid") throw badRequest("الدفعة مسدَّدة — اعكس سدادها قبل حذفها");
  await prisma.leasePayment.delete({ where: { id: payment.id } });
}

/**
 * يولّد دفعات العقد من شروطه (مبلغ الدفعة، كل كم شهر، أول استحقاق) حتى تاريخ (افتراضياً نهاية العقد). تاريخ استحقاق له دفعة
 * قائمة في العقد يُتخطّى، فإعادة التوليد بعد تمديد العقد تضيف الجديد فقط ولا تكرّر ولا تمسّ ما سُدِّد أو عُدِّل.
 */
export async function generateLeaseSchedule(tenantId: string, contractId: string, until?: string) {
  const contract = await contractOrThrow(tenantId, contractId);
  if (!contract.paymentAmount || !contract.paymentEveryMonths || !contract.firstDueDate) {
    throw badRequest("أكمل شروط السداد في العقد أولاً: مبلغ الدفعة، دورية السداد بالأشهر، وتاريخ أول استحقاق");
  }
  if (until !== undefined && !isDateOnly(until)) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
  const limit = until ?? dateToDay(contract.endDate);
  const installments = generateInstallments(dateToDay(contract.firstDueDate), contract.paymentEveryMonths, limit);
  const rate = await companyVatRatePercent(tenantId, contract.companyId);
  const amount = Number(contract.paymentAmount);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.leasePayment.findMany({ where: { tenantId, leaseContractId: contract.id }, select: { dueDate: true } });
    const taken = new Set(existing.map((p) => dateToDay(p.dueDate)));
    const fresh = installments.filter((i) => !taken.has(i.dueDate));
    if (fresh.length > 0) {
      await tx.leasePayment.createMany({
        data: fresh.map((i) => ({
          tenantId, companyId: contract.companyId, leaseContractId: contract.id,
          ...paymentData({ ...i, amount }, contract.vatMode, rate),
        })),
      });
    }
    return { created: fresh.length, skipped: installments.length - fresh.length };
  });
}

// ---------------------------------------------------------------------------
// تأكيد السداد وعكسه
// ---------------------------------------------------------------------------

async function resolveLeaseAccount(tenantId: string, companyId: string, explicitId: string | null, wellKnownName: string, missingMessage: string) {
  if (explicitId) return explicitId;
  try {
    return await getAccountIdByName(tenantId, companyId, wellKnownName);
  } catch {
    throw badRequest(missingMessage);
  }
}

export interface ConfirmPaymentInput {
  paidOn: string;
  bankAccountId?: string;
  // المبلغ المدفوع فعلاً إن اختلف عن المجدول (خصم سداد مقدم مثلاً) — يصبح هو مبلغ الدفعة ويُعاد فصل ضريبته
  amount?: number;
  reference?: string | null;
  note?: string | null;
  // true: سُدِّدت وقُيِّدت خارج الموديول — تُعلَّم مسدَّدة بلا قيد
  postedExternally?: boolean;
  // مع postedExternally: أول شهر يُطفأ داخل الموديول (ما قبله صُرف في الدفاتر من قبل)
  amortizeFromMonth?: string | null;
}

export async function confirmLeasePayment(tenantId: string, userId: string, paymentId: string, input: ConfirmPaymentInput) {
  if (!isDateOnly(input.paidOn)) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
  const payment = await paymentOrThrow(tenantId, paymentId);
  if (payment.status !== "due") throw badRequest(LEASE_PAYMENT_NOT_DUE);
  const contract = payment.leaseContract;
  const companyId = payment.companyId;
  const external = input.postedExternally === true;

  const rate = await companyVatRatePercent(tenantId, companyId);
  const split = splitLeaseVat(input.amount ?? Number(payment.amount), contract.vatMode, rate);
  if (!(split.amount > 0)) throw badRequest("مبلغ الدفعة يجب أن يكون أكبر من صفر");
  const paidOn = dayToDate(input.paidOn);
  const settled = {
    amount: d(split.amount), vatAmount: d(split.vatAmount), netAmount: d(split.netAmount),
    paidOn, paidByUserId: userId, postedExternally: external,
    reference: trimmed(input.reference), ...(input.note !== undefined ? { note: trimmed(input.note) } : {}),
  };

  if (external) {
    if (input.amortizeFromMonth && !isMonthOnly(input.amortizeFromMonth)) throw badRequest("صيغة الشهر يجب أن تكون YYYY-MM");
    const claimed = await prisma.leasePayment.updateMany({
      where: { id: payment.id, tenantId, status: "due" },
      data: { ...settled, status: "paid", bankAccountId: null, journalEntryId: null, amortizeFromMonth: input.amortizeFromMonth || null },
    });
    if (claimed.count !== 1) throw badRequest(LEASE_PAYMENT_NOT_DUE);
    return prisma.leasePayment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  if (!input.bankAccountId) throw badRequest("اختر حساب البنك/الصندوق الذي سُدِّدت منه الدفعة");
  const bank = await prisma.account.findFirst({
    where: { id: input.bankAccountId, tenantId, companyId, isPosting: true, isActive: true, isArchived: false, isBankOrCash: true },
    select: { id: true },
  });
  if (!bank) throw badRequest("حساب السداد يجب أن يكون حساب بنك/نقدية للترحيل من نفس الشركة");
  const prepaidAccountId = await resolveLeaseAccount(tenantId, companyId, contract.prepaidAccountId, LEASE_PREPAID_ACCOUNT_NAME, LEASE_PREPAID_ACCOUNT_MISSING);
  const inputVatAccountId = split.vatAmount > 0 ? await getAccountIdByName(tenantId, companyId, INPUT_VAT_ACCOUNT_NAME) : null;

  const description = `سداد إيجار — ${contract.title} — عن ${dateToDay(payment.periodFrom)} إلى ${dateToDay(payment.periodTo)}`;
  const lines: PostingLine[] = [{ accountId: prepaidAccountId, costCenterId: contract.costCenterId, lineDescription: description, debit: split.netAmount, credit: 0 }];
  if (inputVatAccountId) lines.push({ accountId: inputVatAccountId, lineDescription: `ضريبة المدخلات — ${description}`, debit: split.vatAmount, credit: 0 });
  lines.push({ accountId: bank.id, lineDescription: description, debit: 0, credit: split.amount });

  return prisma.$transaction(async (tx) => {
    // المطالبة بالدفعة أولاً (due ← paid) داخل المعاملة: تأكيدان متزامنان لا ينشئان قيدين
    const claimed = await tx.leasePayment.updateMany({ where: { id: payment.id, tenantId, status: "due" }, data: { ...settled, status: "paid", bankAccountId: bank.id } });
    if (claimed.count !== 1) throw badRequest(LEASE_PAYMENT_NOT_DUE);
    const entry = await createJournalEntryTx(tx, {
      tenantId, companyId, date: paidOn,
      memo: `${description}${settled.reference ? ` — مرجع ${settled.reference}` : ""}`,
      sourceModule: "lease_payment", sourceId: payment.id, createdBy: userId, lines,
    });
    return tx.leasePayment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });
  });
}

/**
 * عكس سداد دفعة: قيد عكسي مربوط بـreversalOfEntryId (بنفس المصدر فيبقى محمياً) وتعود الدفعة «بانتظار السداد» لتُسدَّد من جديد.
 * مرفوض إن أُطفئ منها شيء (يُزال الإطفاء أولاً، وإلا بقي مصروف مرحَّل بلا رصيد مدفوع مقدماً يقابله).
 */
export async function reverseLeasePayment(tenantId: string, userId: string, paymentId: string, input: { reason: string; date?: string }) {
  const reason = input.reason.trim();
  if (!reason) throw badRequest("سبب عكس السداد مطلوب");
  if (input.date !== undefined && !isDateOnly(input.date)) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
  const payment = await paymentOrThrow(tenantId, paymentId);
  if (payment.status !== "paid") throw badRequest("الدفعة غير مسدَّدة — لا يوجد ما يُعكَس");
  const amortized = await prisma.leaseAmortizationLine.count({ where: { leasePaymentId: payment.id } });
  if (amortized > 0) throw badRequest(LEASE_PAYMENT_AMORTIZED);

  const reset = { status: "due" as LeasePaymentStatus, paidOn: null, bankAccountId: null, journalEntryId: null, paidByUserId: null, postedExternally: false, amortizeFromMonth: null, reference: null };
  const audit = (tx: Db, reversalEntryId: string | null) =>
    tx.auditLog.create({
      data: {
        tenantId, companyId: payment.companyId, userId, action: "leasepayment.reverse", entityType: "LeasePayment", entityId: payment.id,
        metadata: { reason, journalEntryId: payment.journalEntryId, reversalEntryId, amount: Number(payment.amount), paidOn: day(payment.paidOn) },
      },
    });

  if (!payment.journalEntryId) {
    // دفعة سُجِّلت مسدَّدة خارج الموديول: لا قيد يُعكَس، تعود للانتظار فقط
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.leasePayment.updateMany({ where: { id: payment.id, tenantId, status: "paid" }, data: reset });
      if (claimed.count !== 1) throw badRequest("الدفعة غير مسدَّدة — لا يوجد ما يُعكَس");
      await audit(tx, null);
      return tx.leasePayment.findUniqueOrThrow({ where: { id: payment.id } });
    });
  }

  const entry = await prisma.journalEntry.findFirst({ where: { id: payment.journalEntryId, tenantId, companyId: payment.companyId }, include: { lines: true } });
  if (!entry) throw notFound("قيد سداد الدفعة غير موجود");
  if (entry.mirrorEntryId) throw badRequest("لقيد هذه الدفعة قيد مرآة في شركة أخرى — لا يمكن عكسها قبل معالجة قيد المرآة");
  const date = dayToDate(input.date ?? riyadhCalendarDay(new Date()));

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.leasePayment.updateMany({ where: { id: payment.id, tenantId, status: "paid" }, data: reset });
    if (claimed.count !== 1) throw badRequest("الدفعة غير مسدَّدة — لا يوجد ما يُعكَس");
    const { entryNumber, entrySeq } = await reserveEntryNumber(tx, tenantId, payment.companyId, date);
    const reversal = await tx.journalEntry.create({
      data: {
        tenantId, companyId: payment.companyId, date,
        memo: `عكس ${entry.memo ?? "قيد سداد إيجار"} — ${reason}`,
        status: "posted", entryNumber, entrySeq,
        sourceModule: "lease_payment", sourceId: payment.id, createdBy: userId, reversalOfEntryId: entry.id,
        lines: {
          create: entry.lines.map((l) => ({
            accountId: l.accountId, costCenterId: l.costCenterId, department: l.department, departmentId: l.departmentId,
            branchId: l.branchId, description: l.description, debit: l.credit, credit: l.debit,
          })),
        },
      },
    });
    await recomputeEntryTotal(tx, reversal.id);
    await audit(tx, reversal.id);
    return tx.leasePayment.update({ where: { id: payment.id }, data: { lastReversalEntryId: reversal.id } });
  });
}

// ---------------------------------------------------------------------------
// التقويم
// ---------------------------------------------------------------------------

/**
 * تقويم الإيجارات لفترة: دفعات الشركة التي تستحق داخل [from, to] مع عقدها وحالتها، والمتأخر منها (استحق قبل اليوم ولم يُسدَّد).
 * الملخص الشهري (المستحق/المسدَّد/الضريبة) محسوب من الدفعات نفسها، و«سماح» لا تدخل في المستحق.
 */
export async function leaseCalendar(tenantId: string, companyId: string, range: { from: string; to: string }) {
  if (!isDateOnly(range.from) || !isDateOnly(range.to)) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
  if (range.from > range.to) throw badRequest("تاريخ البداية بعد تاريخ النهاية");
  await companyOrThrow(tenantId, companyId);

  const [contracts, payments, costCenters] = await Promise.all([
    prisma.leaseContract.findMany({ where: { tenantId, companyId }, orderBy: [{ title: "asc" }] }),
    prisma.leasePayment.findMany({
      where: { tenantId, companyId, dueDate: { gte: dayToDate(range.from), lte: dayToDate(range.to) } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.costCenter.findMany({ where: { tenantId, OR: [{ companyId }, { companyId: null }] }, select: { id: true, name: true } }),
  ]);
  const entryIds = payments.flatMap((p) => [p.journalEntryId, p.lastReversalEntryId]).filter((id): id is string => !!id);
  const entries = entryIds.length
    ? await prisma.journalEntry.findMany({ where: { tenantId, companyId, id: { in: entryIds } }, select: { id: true, entryNumber: true } })
    : [];
  const entryNumber = new Map(entries.map((e) => [e.id, e.entryNumber]));
  const costCenterName = new Map(costCenters.map((c) => [c.id, c.name]));
  const today = riyadhCalendarDay(new Date());

  const rows = payments.map((p) => {
    const dueDate = dateToDay(p.dueDate);
    return {
      id: p.id,
      leaseContractId: p.leaseContractId,
      dueDate,
      month: dueDate.slice(0, 7),
      periodFrom: dateToDay(p.periodFrom),
      periodTo: dateToDay(p.periodTo),
      amount: Number(p.amount),
      vatAmount: Number(p.vatAmount),
      netAmount: Number(p.netAmount),
      status: p.status,
      overdue: p.status === "due" && dueDate < today,
      paidOn: day(p.paidOn),
      bankAccountId: p.bankAccountId,
      postedExternally: p.postedExternally,
      amortizeFromMonth: p.amortizeFromMonth,
      reference: p.reference,
      note: p.note,
      journalEntryId: p.journalEntryId,
      entryNumber: p.journalEntryId ? entryNumber.get(p.journalEntryId) ?? null : null,
      lastReversalEntryNumber: p.lastReversalEntryId ? entryNumber.get(p.lastReversalEntryId) ?? null : null,
    };
  });

  const months = new Map<string, { month: string; due: number[]; paid: number[]; outstanding: number[]; vat: number[]; count: number }>();
  for (const r of rows) {
    if (r.status === "waived") continue;
    const m = months.get(r.month) ?? { month: r.month, due: [], paid: [], outstanding: [], vat: [], count: 0 };
    m.due.push(r.amount);
    m.vat.push(r.vatAmount);
    (r.status === "paid" ? m.paid : m.outstanding).push(r.amount);
    m.count += 1;
    months.set(r.month, m);
  }
  const live = rows.filter((r) => r.status !== "waived");

  return {
    from: range.from,
    to: range.to,
    today,
    contracts: contracts.map((c) => ({
      id: c.id, title: c.title, counterparty: c.counterparty, vatMode: c.vatMode, isActive: c.isActive,
      costCenterId: c.costCenterId, costCenterName: c.costCenterId ? costCenterName.get(c.costCenterId) ?? null : null,
      paymentAmount: c.paymentAmount === null ? null : Number(c.paymentAmount), paymentEveryMonths: c.paymentEveryMonths,
      firstDueDate: day(c.firstDueDate), startDate: dateToDay(c.startDate), endDate: dateToDay(c.endDate),
      expenseAccountId: c.expenseAccountId, prepaidAccountId: c.prepaidAccountId, notes: c.notes, monthlyRent: c.monthlyRent === null ? null : Number(c.monthlyRent),
      contractNumber: c.contractNumber, signedOn: day(c.signedOn), contractValue: c.contractValue === null ? null : Number(c.contractValue),
      depositAmount: c.depositAmount === null ? null : Number(c.depositAmount), customTerms: c.customTerms, autoRenew: c.autoRenew, noticeDays: c.noticeDays,
      noticeDeadline: noticeDeadline(dateToDay(c.endDate), c.noticeDays), lessorDetails: c.lessorDetails, propertyDetails: c.propertyDetails,
    })),
    payments: rows,
    months: [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ month: m.month, due: sumMoney(m.due), paid: sumMoney(m.paid), outstanding: sumMoney(m.outstanding), vat: sumMoney(m.vat), count: m.count })),
    totals: {
      due: sumMoney(live.map((r) => r.amount)),
      paid: sumMoney(live.filter((r) => r.status === "paid").map((r) => r.amount)),
      outstanding: sumMoney(live.filter((r) => r.status === "due").map((r) => r.amount)),
      overdue: sumMoney(live.filter((r) => r.overdue).map((r) => r.amount)),
      overdueCount: live.filter((r) => r.overdue).length,
      vat: sumMoney(live.map((r) => r.vatAmount)),
    },
  };
}

export const LEASE_ALERT_DUE_WITHIN_DAYS = 30;
export const LEASE_ALERT_RENEWAL_WITHIN_DAYS = 90;

/**
 * تنبيهات الإيجارات للشركة (العقود السارية isActive فقط): دفعات متأخرة، دفعات تستحق خلال 30 يوماً، وعقود اقترب آخر موعد للإشعار
 * بعدم تجديدها (خلال 90 يوماً) أو فات والعقد لم ينتهِ، أو انتهت مدتها. آخر موعد للإشعار = نهاية العقد − مهلة الإشعار.
 */
export async function leaseAlerts(tenantId: string, companyId: string) {
  await companyOrThrow(tenantId, companyId);
  const today = riyadhCalendarDay(new Date());
  const horizon = dayToDate(addDays(today, LEASE_ALERT_DUE_WITHIN_DAYS));
  const [contracts, payments] = await Promise.all([
    prisma.leaseContract.findMany({ where: { tenantId, companyId, isActive: true }, orderBy: { endDate: "asc" } }),
    prisma.leasePayment.findMany({
      where: { tenantId, companyId, status: "due", dueDate: { lte: horizon }, leaseContract: { isActive: true } },
      include: { leaseContract: { select: { title: true, counterparty: true } } },
      orderBy: { dueDate: "asc" },
    }),
  ]);
  const paymentRows = payments.map((p) => {
    const dueDate = dateToDay(p.dueDate);
    return {
      id: p.id, leaseContractId: p.leaseContractId, title: p.leaseContract.title, counterparty: p.leaseContract.counterparty,
      dueDate, amount: Number(p.amount), days: daysBetween(today, dueDate), note: p.note,
    };
  });
  const renewals = contracts
    .map((c) => {
      const endDate = dateToDay(c.endDate);
      const deadline = noticeDeadline(endDate, c.noticeDays);
      const daysToDeadline = daysBetween(today, deadline);
      const daysToEnd = daysBetween(today, endDate);
      const kind = daysToEnd < 0 ? "expired" : daysToDeadline < 0 ? "notice_passed" : "notice_soon";
      return { id: c.id, title: c.title, counterparty: c.counterparty, endDate, noticeDays: c.noticeDays, autoRenew: c.autoRenew, noticeDeadline: deadline, daysToDeadline, daysToEnd, kind };
    })
    .filter((r) => r.daysToDeadline <= LEASE_ALERT_RENEWAL_WITHIN_DAYS)
    .sort((a, b) => a.daysToDeadline - b.daysToDeadline);
  const overdue = paymentRows.filter((p) => p.days < 0);
  const dueSoon = paymentRows.filter((p) => p.days >= 0);
  return {
    today, dueWithinDays: LEASE_ALERT_DUE_WITHIN_DAYS, renewalWithinDays: LEASE_ALERT_RENEWAL_WITHIN_DAYS,
    overdue, dueSoon, renewals,
    totals: { overdue: sumMoney(overdue.map((p) => p.amount)), dueSoon: sumMoney(dueSoon.map((p) => p.amount)) },
  };
}

// ---------------------------------------------------------------------------
// بريد التنبيهات اليومي
// ---------------------------------------------------------------------------

const REMINDER_DEFAULTS = { enabled: false, hourKsa: 8, minuteKsa: 0, recipientEmails: [] as string[], lastSentAt: null as Date | null };

/** إعداد بريد التنبيهات للشركة؛ بلا صف محفوظ = غير مفعّل بالقيم الافتراضية. */
export async function getLeaseReminderSetting(tenantId: string, companyId: string) {
  await companyOrThrow(tenantId, companyId);
  const row = await prisma.leaseReminderSetting.findFirst({ where: { tenantId, companyId } });
  const setting = row ? { enabled: row.enabled, hourKsa: row.hourKsa, minuteKsa: row.minuteKsa, recipientEmails: row.recipientEmails, lastSentAt: row.lastSentAt } : REMINDER_DEFAULTS;
  return { ...setting, effectiveRecipients: await resolveRecipientEmails(tenantId, companyId, setting.recipientEmails) };
}

export async function upsertLeaseReminderSetting(tenantId: string, companyId: string, input: { enabled: boolean; hourKsa: number; minuteKsa?: number; recipientEmails: string[] }) {
  await companyOrThrow(tenantId, companyId);
  const recipientEmails = [...new Set(input.recipientEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const data = { enabled: input.enabled, hourKsa: input.hourKsa, minuteKsa: input.minuteKsa ?? 0, recipientEmails };
  await prisma.leaseReminderSetting.upsert({ where: { companyId }, create: { tenantId, companyId, ...data }, update: data });
  return getLeaseReminderSetting(tenantId, companyId);
}

/**
 * يبني بريد التنبيهات من leaseAlerts نفسها ويرسله لمستلمي الشركة. لا يُرسَل بريد فارغ: بلا تنبيهات أو بلا مستلمين يرجع sent:false
 * بسببه. يستدعيه المُجدوِل اليومي وزر «إرسال الآن» (الذي لا يستهلك إرسال اليوم المجدول).
 */
export async function sendLeaseReminder(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { name: true, language: true } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  const alerts = await leaseAlerts(tenantId, companyId);
  if (!hasLeaseAlerts(alerts)) return { sent: false, reason: "no_alerts" as const, recipients: 0 };
  const setting = await prisma.leaseReminderSetting.findFirst({ where: { tenantId, companyId }, select: { recipientEmails: true } });
  const recipients = await resolveRecipientEmails(tenantId, companyId, setting?.recipientEmails ?? []);
  if (recipients.length === 0) return { sent: false, reason: "no_recipients" as const, recipients: 0 };
  const lang = (company.language as Lang) ?? "ar";
  const email = buildLeaseReminderEmail(company.name, alerts, lang, `${env.frontendBaseUrl}/leases/leaseContracts`);
  await sendLeaseReminderEmail(recipients, email.subject, email.bodyHtml, lang);
  return { sent: true, reason: null, recipients: recipients.length };
}

// ---------------------------------------------------------------------------
// الإطفاء الشهري
// ---------------------------------------------------------------------------

function assertMonth(month: string) {
  if (!isMonthOnly(month)) throw badRequest("صيغة الشهر يجب أن تكون YYYY-MM");
}

/** صفوف إطفاء شهر: لكل دفعة مسدَّدة بدأت فترتها حتى نهاية الشهر — المستحق إطفاؤه تراكمياً ناقص ما أُطفئ فعلاً. */
async function amortizationRows(db: Db, tenantId: string, companyId: string, month: string) {
  const monthEnd = dayToDate(monthEndDay(month));
  const payments = await db.leasePayment.findMany({
    where: { tenantId, companyId, status: "paid", periodFrom: { lte: monthEnd } },
    include: { leaseContract: true, amortizationLines: { select: { amount: true } } },
    orderBy: [{ periodFrom: "asc" }, { createdAt: "asc" }],
  });
  return payments
    .map((p) => {
      const net = Number(p.netAmount);
      const periodFrom = dateToDay(p.periodFrom);
      const periodTo = dateToDay(p.periodTo);
      // ما صُرف من الدفعة قبل بدء استخدام الموديول (كل أشهر فترتها قبل amortizeFromMonth) يُعَد مُطفأً فلا يُلحَق
      const expensedOutside = p.amortizeFromMonth ? amortizedThrough(net, periodFrom, periodTo, addMonths(`${p.amortizeFromMonth}-01`, -1).slice(0, 7)) : 0;
      const already = sumMoney([...p.amortizationLines.map((l) => Number(l.amount)), expensedOutside]);
      const target = Math.max(amortizedThrough(net, periodFrom, periodTo, month), expensedOutside);
      return {
        leasePaymentId: p.id,
        leaseContractId: p.leaseContractId,
        title: p.leaseContract.title,
        costCenterId: p.leaseContract.costCenterId,
        expenseAccountId: p.leaseContract.expenseAccountId,
        prepaidAccountId: p.leaseContract.prepaidAccountId,
        periodFrom,
        periodTo,
        netAmount: net,
        alreadyAmortized: already,
        monthShare: amortizationPlan(net, periodFrom, periodTo).find((m) => m.month === month)?.amount ?? 0,
        amount: roundMoney(target - already),
        remainingAfter: roundMoney(net - target),
      };
    })
    .filter((r) => r.amount > 0);
}

/** دفعات لم تُسدَّد تغطي الشهر: مصروفها لا يدخل الإطفاء حتى تُسدَّد — تُعرَض تنبيهاً في المعاينة. */
async function unpaidCoveringMonth(tenantId: string, companyId: string, month: string) {
  const rows = await prisma.leasePayment.findMany({
    where: { tenantId, companyId, status: "due", periodFrom: { lte: dayToDate(monthEndDay(month)) }, periodTo: { gte: dayToDate(`${month}-01`) } },
    include: { leaseContract: { select: { title: true } } },
    orderBy: { dueDate: "asc" },
  });
  return rows.map((p) => ({ leasePaymentId: p.id, title: p.leaseContract.title, dueDate: dateToDay(p.dueDate), amount: Number(p.amount) }));
}

export async function previewLeaseAmortization(tenantId: string, companyId: string, month: string) {
  assertMonth(month);
  await companyOrThrow(tenantId, companyId);
  const [rows, unpaid, existingRun] = await Promise.all([
    amortizationRows(prisma, tenantId, companyId, month),
    unpaidCoveringMonth(tenantId, companyId, month),
    prisma.leaseAmortizationRun.findFirst({ where: { tenantId, companyId, month } }),
  ]);
  return { month, rows, total: sumMoney(rows.map((r) => r.amount)), unpaid, alreadyPosted: Boolean(existingRun), existingRun };
}

export async function listLeaseAmortizationRuns(tenantId: string, companyId: string) {
  await companyOrThrow(tenantId, companyId);
  const runs = await prisma.leaseAmortizationRun.findMany({ where: { tenantId, companyId }, orderBy: { month: "desc" }, include: { _count: { select: { lines: true } } } });
  const entries = runs.length
    ? await prisma.journalEntry.findMany({ where: { tenantId, companyId, id: { in: runs.map((r) => r.journalEntryId) } }, select: { id: true, entryNumber: true } })
    : [];
  const entryNumber = new Map(entries.map((e) => [e.id, e.entryNumber]));
  return runs.map((r) => ({
    id: r.id, month: r.month, totalAmount: Number(r.totalAmount), journalEntryId: r.journalEntryId,
    entryNumber: entryNumber.get(r.journalEntryId) ?? null, lineCount: r._count.lines, createdAt: r.createdAt,
  }));
}

export async function postLeaseAmortization(tenantId: string, userId: string, companyId: string, month: string) {
  assertMonth(month);
  await companyOrThrow(tenantId, companyId);

  return prisma.$transaction(async (tx) => {
    // قفل صف الشركة: ترحيلان متزامنان لشهرين مختلفين لا يحسبان «ما أُطفئ» من لقطة واحدة فيتكرر اللحاق
    await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const runs = await tx.leaseAmortizationRun.findMany({ where: { tenantId, companyId }, select: { month: true } });
    if (runs.some((r) => r.month === month)) throw badRequest(LEASE_RUN_EXISTS);
    if (runs.some((r) => r.month > month)) throw badRequest(LEASE_RUN_OUT_OF_ORDER);

    const rows = await amortizationRows(tx, tenantId, companyId, month);
    if (rows.length === 0) throw badRequest(LEASE_NOTHING_TO_AMORTIZE);

    const fallback: { expense?: string; prepaid?: string } = {};
    const lines: PostingLine[] = [];
    for (const r of rows) {
      const expenseAccountId = r.expenseAccountId ?? (fallback.expense ??= await resolveLeaseAccount(tenantId, companyId, null, LEASE_EXPENSE_ACCOUNT_NAME, LEASE_EXPENSE_ACCOUNT_MISSING));
      const prepaidAccountId = r.prepaidAccountId ?? (fallback.prepaid ??= await resolveLeaseAccount(tenantId, companyId, null, LEASE_PREPAID_ACCOUNT_NAME, LEASE_PREPAID_ACCOUNT_MISSING));
      const description = `إيجار ${month} — ${r.title}`;
      lines.push({ accountId: expenseAccountId, costCenterId: r.costCenterId, lineDescription: description, debit: r.amount, credit: 0 });
      lines.push({ accountId: prepaidAccountId, costCenterId: r.costCenterId, lineDescription: description, debit: 0, credit: r.amount });
    }
    const total = sumMoney(rows.map((r) => r.amount));

    const entry = await createJournalEntryTx(tx, {
      tenantId, companyId, date: dayToDate(monthEndDay(month)),
      memo: `إطفاء الإيجارات المدفوعة مقدماً — شهر ${month}`,
      sourceModule: "lease_amortization", createdBy: userId, lines,
    });
    const run = await tx.leaseAmortizationRun.create({
      data: {
        tenantId, companyId, month, totalAmount: d(total), journalEntryId: entry.id, createdByUserId: userId,
        lines: { create: rows.map((r) => ({ leasePaymentId: r.leasePaymentId, leaseContractId: r.leaseContractId, amount: d(r.amount) })) },
      },
    });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: run.id } });
    return { id: run.id, month: run.month, totalAmount: total, journalEntryId: entry.id, entryNumber: entry.entryNumber, lineCount: rows.length };
  });
}

/** إزالة إطفاء شهر (آخر شهر مرحَّل فقط) — يحذف القيد والسجل معاً ليُعاد ترحيله بعد التصحيح. بالرقم السري لفك الترحيل. */
export async function removeLeaseAmortizationRun(tenantId: string, userId: string, runId: string, pin: string) {
  const run = await prisma.leaseAmortizationRun.findFirst({ where: { id: runId, tenantId } });
  if (!run) throw notFound("سجل إطفاء الإيجارات غير موجود");
  await assertValidUnlockPin(tenantId, pin, userId);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM companies WHERE id = ${run.companyId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const newer = await tx.leaseAmortizationRun.count({ where: { tenantId, companyId: run.companyId, month: { gt: run.month } } });
    if (newer > 0) throw badRequest(LEASE_RUN_NOT_LATEST);
    await deleteJournalEntryTx(tx, run.journalEntryId);
    await tx.leaseAmortizationRun.delete({ where: { id: run.id } });
    await writeUnpostAuditLogTx(tx, { tenantId, userId, companyId: run.companyId, entityType: "LeaseAmortizationRun", entityId: run.id, metadata: { month: run.month, totalAmount: Number(run.totalAmount) } });
  });
}

// ---------------------------------------------------------------------------
// الاستيراد الجماعي (عقود مع جداول دفعاتها)
// ---------------------------------------------------------------------------

export interface ImportContractInput {
  title: string;
  counterparty?: string | null;
  notes?: string | null;
  vatMode: LeaseVatMode;
  startDate: string;
  endDate: string;
  costCenterName?: string | null;
  paymentAmount?: number | null;
  paymentEveryMonths?: number | null;
  firstDueDate?: string | null;
  isActive?: boolean;
  signedOn?: string | null;
  contractNumber?: string | null;
  contractValue?: number | null;
  depositAmount?: number | null;
  customTerms?: string | null;
  autoRenew?: boolean;
  noticeDays?: number | null;
  lessorDetails?: Record<string, string | null | undefined> | null;
  propertyDetails?: Record<string, string | null | undefined> | null;
  payments: { dueDate: string; periodFrom: string; periodTo: string; amount: number; status?: "due" | "waived" | "paid_external"; paidOn?: string | null; amortizeFromMonth?: string | null; note?: string | null }[];
}

/**
 * استيراد عقود بجداول دفعاتها لشركة — كله أو لا شيء. عقد بعنوان موجود في الشركة يُرفض الاستيراد كله (لا دمج ولا تكرار صامت).
 * مركز التكلفة يُطابَق بالاسم داخل الشركة نفسها؛ الاسم غير الموجود يُرفض. «paid_external» دفعة سُدِّدت قبل بدء استخدام الموديول:
 * تُسجَّل مسدَّدة بلا قيد وتُطفأ.
 */
export async function importLeaseContracts(tenantId: string, userId: string, companyId: string, contracts: ImportContractInput[]) {
  await companyOrThrow(tenantId, companyId);
  if (contracts.length === 0) throw badRequest("ملف الاستيراد لا يحتوي عقوداً");
  const titles = contracts.map((c) => c.title.trim());
  if (new Set(titles).size !== titles.length) throw badRequest("ملف الاستيراد يكرّر عنوان عقد أكثر من مرة");

  for (const c of contracts) {
    if (!isDateOnly(c.startDate) || !isDateOnly(c.endDate) || (c.firstDueDate && !isDateOnly(c.firstDueDate)) || (c.signedOn && !isDateOnly(c.signedOn))) throw badRequest("صيغة التاريخ يجب أن تكون YYYY-MM-DD");
    if (c.startDate > c.endDate) throw badRequest("تاريخ نهاية العقد يسبق تاريخ بدايته");
    for (const p of c.payments) {
      assertPaymentDates(p);
      if (!(p.amount > 0)) throw badRequest("مبلغ الدفعة يجب أن يكون أكبر من صفر");
      if (p.status === "paid_external" && (!p.paidOn || !isDateOnly(p.paidOn))) throw badRequest("دفعة مسدَّدة خارج النظام تحتاج تاريخ سداد بصيغة YYYY-MM-DD");
      if (p.amortizeFromMonth && !isMonthOnly(p.amortizeFromMonth)) throw badRequest("صيغة الشهر يجب أن تكون YYYY-MM");
    }
  }

  const [existing, costCenters, rate] = await Promise.all([
    prisma.leaseContract.findMany({ where: { tenantId, companyId, title: { in: titles } }, select: { title: true } }),
    // مركز الشركة نفسها يسبق المشترك إن تطابق الاسمان (الترتيب: المشترك أولاً فيكتب فوقه مركز الشركة في الخريطة)
    prisma.costCenter.findMany({ where: { tenantId, OR: [{ companyId }, { companyId: null }] }, select: { id: true, name: true }, orderBy: { companyId: { sort: "asc", nulls: "first" } } }),
    companyVatRatePercent(tenantId, companyId),
  ]);
  if (existing.length > 0) throw badRequest("في الشركة عقد إيجار بعنوان وارد في ملف الاستيراد — احذف المكرر من الملف أو من النظام ثم أعد الاستيراد", { titles: existing.map((e) => e.title) });
  const costCenterId = new Map(costCenters.map((c) => [c.name.trim(), c.id]));
  const unknownCostCenters = [...new Set(contracts.map((c) => c.costCenterName?.trim()).filter((n): n is string => !!n && !costCenterId.has(n)))];
  if (unknownCostCenters.length > 0) throw badRequest("في ملف الاستيراد مركز تكلفة غير موجود في الشركة — أضفه من شاشة مراكز التكلفة أو اترك الخانة فارغة", { costCenters: unknownCostCenters });

  return prisma.$transaction(async (tx) => {
    let paymentCount = 0;
    for (const c of contracts) {
      const contract = await tx.leaseContract.create({
        data: {
          tenantId, companyId, title: c.title.trim(), counterparty: trimmed(c.counterparty), notes: trimmed(c.notes), vatMode: c.vatMode,
          startDate: dayToDate(c.startDate), endDate: dayToDate(c.endDate),
          costCenterId: c.costCenterName?.trim() ? costCenterId.get(c.costCenterName.trim())! : null,
          paymentAmount: c.paymentAmount ? d(c.paymentAmount) : null, paymentEveryMonths: c.paymentEveryMonths ?? null,
          firstDueDate: c.firstDueDate ? dayToDate(c.firstDueDate) : null,
          isActive: c.isActive ?? true, signedOn: c.signedOn ? dayToDate(c.signedOn) : null, contractNumber: trimmed(c.contractNumber),
          contractValue: c.contractValue != null ? d(c.contractValue) : null, depositAmount: c.depositAmount != null ? d(c.depositAmount) : null,
          customTerms: trimmed(c.customTerms), autoRenew: c.autoRenew ?? false, noticeDays: c.noticeDays ?? null,
          lessorDetails: jsonColumn(c.lessorDetails ?? null), propertyDetails: jsonColumn(c.propertyDetails ?? null),
        },
      });
      if (c.payments.length > 0) {
        await tx.leasePayment.createMany({
          data: c.payments.map((p) => {
            const external = p.status === "paid_external";
            return {
              tenantId, companyId, leaseContractId: contract.id,
              ...paymentData(p, c.vatMode, rate),
              status: (external ? "paid" : p.status ?? "due") as LeasePaymentStatus,
              postedExternally: external, paidOn: external ? dayToDate(p.paidOn!) : null, paidByUserId: external ? userId : null,
              amortizeFromMonth: external ? p.amortizeFromMonth || null : null,
              note: trimmed(p.note),
            };
          }),
        });
        paymentCount += c.payments.length;
      }
    }
    return { contracts: contracts.length, payments: paymentCount };
  });
}
