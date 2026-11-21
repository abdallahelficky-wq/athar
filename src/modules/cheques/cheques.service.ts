import type { ChequeDirection, ChequeEventType, ChequeStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../lib/httpError";
import { createJournalEntryTx, deleteJournalEntryTx } from "../../lib/journalPosting";
import { resolvePartyAccountId } from "../../lib/partyAccounts";
import { toHalalas } from "../../lib/money";

/**
 * الشيكات الواردة والصادرة بدورة حياتها: تسجيل ← تحصيل/صرف، أو ارتداد/إلغاء. كل حدث يُنشئ قيده (sourceModule "cheque")
 * ويُسجَّل في ChequeEvent؛ والتراجع عن آخر حدث يحذف قيده (deleteJournalEntryTx: يحترم الإقفال والتسوية البنكية) ويعيد
 * الحالة السابقة — التراجع عن التسجيل نفسه يحذف الشيك.
 *
 *   وارد: تسجيل  من ح/ أوراق القبض إلى ح/ الطرف       | تحصيل من ح/ البنك إلى ح/ أوراق القبض | ارتداد/إلغاء من ح/ الطرف إلى ح/ أوراق القبض
 *   صادر: تسجيل  من ح/ الطرف إلى ح/ أوراق الدفع       | صرف   من ح/ أوراق الدفع إلى ح/ البنك | ارتداد/إلغاء من ح/ أوراق الدفع إلى ح/ الطرف
 */
type Tx = Prisma.TransactionClient;

export interface CreateChequeInput {
  companyId: string;
  direction: ChequeDirection;
  chequeNumber: string;
  bankName?: string | null;
  issueDate: string;
  dueDate: string;
  amount: number;
  customerId?: string | null;
  supplierId?: string | null;
  counterAccountId?: string | null;
  partyName?: string | null;
  memo?: string | null;
}

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const chequeInclude = {
  customer: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  counterAccount: { select: { id: true, code: true, name: true } },
  bankAccount: { select: { id: true, code: true, name: true } },
  events: { orderBy: { createdAt: "asc" as const }, include: { journalEntry: { select: { id: true, entryNumber: true } } } },
};

async function settingsAccounts(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { chequesReceivableAccountId: true, chequesPayableAccountId: true } });
  if (!company) throw notFound("الشركة غير موجودة");
  return company;
}

async function assertPostingAccount(tenantId: string, companyId: string, accountId: string, message: string, check?: (a: { type: string; isBankOrCash: boolean }) => boolean) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, tenantId, companyId, isPosting: true, isActive: true, isArchived: false },
    select: { type: true, isBankOrCash: true },
  });
  if (!account || (check && !check(account))) throw badRequest(message);
}

export async function updateChequeSettings(tenantId: string, companyId: string, input: { chequesReceivableAccountId?: string | null; chequesPayableAccountId?: string | null }) {
  await settingsAccounts(tenantId, companyId);
  if (input.chequesReceivableAccountId) await assertPostingAccount(tenantId, companyId, input.chequesReceivableAccountId, "حساب أوراق القبض يجب أن يكون حساب أصل قابلاً للترحيل في شجرة الشركة", (a) => a.type === "asset" && !a.isBankOrCash);
  if (input.chequesPayableAccountId) await assertPostingAccount(tenantId, companyId, input.chequesPayableAccountId, "حساب أوراق الدفع يجب أن يكون حساب التزام قابلاً للترحيل في شجرة الشركة", (a) => a.type === "liability");
  return prisma.company.update({
    where: { id: companyId },
    data: {
      ...(input.chequesReceivableAccountId !== undefined ? { chequesReceivableAccountId: input.chequesReceivableAccountId } : {}),
      ...(input.chequesPayableAccountId !== undefined ? { chequesPayableAccountId: input.chequesPayableAccountId } : {}),
    },
    select: { id: true, chequesReceivableAccountId: true, chequesPayableAccountId: true },
  });
}

export async function getChequeSettings(tenantId: string, companyId: string) {
  return settingsAccounts(tenantId, companyId);
}

export async function listCheques(tenantId: string, companyId: string, filters: { direction?: ChequeDirection; status?: ChequeStatus; dueTo?: string }) {
  return prisma.cheque.findMany({
    where: {
      tenantId,
      companyId,
      ...(filters.direction ? { direction: filters.direction } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.dueTo ? { dueDate: { lte: day(filters.dueTo) } } : {}),
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: 1000,
    include: chequeInclude,
  });
}

export async function getCheque(tenantId: string, id: string) {
  const cheque = await prisma.cheque.findFirst({ where: { id, tenantId }, include: chequeInclude });
  if (!cheque) throw notFound("الشيك غير موجود");
  return cheque;
}

/** أسطر قيد حدث على شيك — مدين/دائن بين ثلاثة حسابات: الطرف، الوسيط (أوراق قبض/دفع)، البنك */
function eventLines(cheque: { direction: ChequeDirection; counterAccountId: string; customerId: string | null; supplierId: string | null }, type: ChequeEventType, amount: number, middleAccountId: string, bankAccountId?: string | null) {
  const party = { accountId: cheque.counterAccountId, customerId: cheque.customerId, supplierId: cheque.supplierId };
  const dr = (accountId: string, extra: object = {}) => ({ accountId, debit: amount, credit: 0, ...extra });
  const cr = (accountId: string, extra: object = {}) => ({ accountId, debit: 0, credit: amount, ...extra });
  const partyExtra = { customerId: party.customerId, supplierId: party.supplierId };
  if (cheque.direction === "received") {
    if (type === "registered") return [dr(middleAccountId), cr(party.accountId, partyExtra)];
    if (type === "cleared") return [dr(bankAccountId!), cr(middleAccountId)];
    return [dr(party.accountId, partyExtra), cr(middleAccountId)];
  }
  if (type === "registered") return [dr(party.accountId, partyExtra), cr(middleAccountId)];
  if (type === "cleared") return [dr(middleAccountId), cr(bankAccountId!)];
  return [dr(middleAccountId), cr(party.accountId, partyExtra)];
}

const EVENT_MEMO: Record<ChequeEventType, Record<ChequeDirection, string>> = {
  registered: { received: "تسجيل شيك وارد", issued: "تسجيل شيك صادر" },
  cleared: { received: "تحصيل شيك وارد", issued: "صرف شيك صادر" },
  bounced: { received: "ارتداد شيك وارد", issued: "ارتداد شيك صادر" },
  cancelled: { received: "إلغاء شيك وارد", issued: "إلغاء شيك صادر" },
};

async function postEvent(
  tx: Tx,
  cheque: { id: string; tenantId: string; companyId: string; direction: ChequeDirection; chequeNumber: string; counterAccountId: string; customerId: string | null; supplierId: string | null; amount: Prisma.Decimal | number },
  type: ChequeEventType,
  date: Date,
  userId: string,
  middleAccountId: string,
  bankAccountId?: string | null,
  note?: string | null,
) {
  const entry = await createJournalEntryTx(tx, {
    tenantId: cheque.tenantId,
    companyId: cheque.companyId,
    date,
    memo: `${EVENT_MEMO[type][cheque.direction]} رقم ${cheque.chequeNumber}${note ? ` — ${note}` : ""}`,
    sourceModule: "cheque",
    sourceId: cheque.id,
    createdBy: userId,
    lines: eventLines(cheque, type, Number(cheque.amount), middleAccountId, bankAccountId),
  });
  await tx.chequeEvent.create({
    data: { chequeId: cheque.id, tenantId: cheque.tenantId, companyId: cheque.companyId, type, date, journalEntryId: entry.id, note: note || null, createdById: userId },
  });
}

const middleOf = (settings: { chequesReceivableAccountId: string | null; chequesPayableAccountId: string | null }, direction: ChequeDirection) => {
  const id = direction === "received" ? settings.chequesReceivableAccountId : settings.chequesPayableAccountId;
  if (!id) throw badRequest(direction === "received" ? "حدّد حساب أوراق القبض (شيكات تحت التحصيل) في إعدادات الشيكات أولاً" : "حدّد حساب أوراق الدفع (شيكات مستحقة الدفع) في إعدادات الشيكات أولاً");
  return id;
};

export async function createCheque(tenantId: string, userId: string, input: CreateChequeInput) {
  const settings = await settingsAccounts(tenantId, input.companyId);
  const middle = middleOf(settings, input.direction);
  if (toHalalas(input.amount) <= 0) throw badRequest("مبلغ الشيك يجب أن يكون أكبر من صفر");
  if (day(input.dueDate) < day(input.issueDate)) throw badRequest("تاريخ استحقاق الشيك قبل تاريخ تسجيله");

  let counterAccountId: string;
  let customerId: string | null = null;
  let supplierId: string | null = null;
  if (input.customerId) {
    const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, companyId: input.companyId }, select: { id: true, accountId: true } });
    if (!customer) throw notFound("العميل غير موجود");
    customerId = customer.id;
    counterAccountId = await resolvePartyAccountId(tenantId, input.companyId, customer, "ذمم مدينة");
  } else if (input.supplierId) {
    const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, tenantId, companyId: input.companyId }, select: { id: true, accountId: true } });
    if (!supplier) throw notFound("المورد غير موجود");
    supplierId = supplier.id;
    counterAccountId = await resolvePartyAccountId(tenantId, input.companyId, supplier, "ذمم دائنة - موردين");
  } else if (input.counterAccountId) {
    await assertPostingAccount(tenantId, input.companyId, input.counterAccountId, "الحساب المقابل غير موجود في شجرة الشركة أو ليس حساب ترحيل نشطاً");
    counterAccountId = input.counterAccountId;
  } else {
    throw badRequest("حدّد العميل أو المورد أو الحساب المقابل للشيك");
  }

  const id = await prisma.$transaction(async (tx) => {
    const cheque = await tx.cheque.create({
      data: {
        tenantId,
        companyId: input.companyId,
        direction: input.direction,
        chequeNumber: input.chequeNumber.trim(),
        bankName: input.bankName?.trim() || null,
        issueDate: day(input.issueDate),
        dueDate: day(input.dueDate),
        amount: input.amount,
        customerId,
        supplierId,
        counterAccountId,
        partyName: input.partyName?.trim() || null,
        memo: input.memo?.trim() || null,
        createdById: userId,
      },
    });
    await postEvent(tx, cheque, "registered", cheque.issueDate, userId, middle, null, cheque.memo);
    return cheque.id;
  });
  return getCheque(tenantId, id);
}

export async function applyChequeAction(
  tenantId: string,
  userId: string,
  id: string,
  action: "clear" | "bounce" | "cancel",
  input: { date: string; bankAccountId?: string | null; note?: string | null },
) {
  const cheque = await getCheque(tenantId, id);
  if (cheque.status !== "pending") throw conflict("الشيك ليس قائماً — تراجع عن آخر حركة عليه أولاً");
  const settings = await settingsAccounts(tenantId, cheque.companyId);
  const middle = middleOf(settings, cheque.direction);
  const date = day(input.date);
  const type: ChequeEventType = action === "clear" ? "cleared" : action === "bounce" ? "bounced" : "cancelled";
  if (type === "cleared") {
    if (!input.bankAccountId) throw badRequest("اختر حساب البنك");
    await assertPostingAccount(tenantId, cheque.companyId, input.bankAccountId, "حساب البنك يجب أن يكون حساب بنك/صندوق قابلاً للترحيل في شجرة الشركة", (a) => a.isBankOrCash);
  }
  await prisma.$transaction(async (tx) => {
    const claim = await tx.cheque.updateMany({
      where: { id, status: "pending" },
      data: { status: type, ...(type === "cleared" ? { bankAccountId: input.bankAccountId } : {}) },
    });
    if (claim.count === 0) throw conflict("الشيك ليس قائماً — تراجع عن آخر حركة عليه أولاً");
    await postEvent(tx, cheque, type, date, userId, middle, input.bankAccountId, input.note);
  });
  return getCheque(tenantId, id);
}

/** التراجع عن آخر حدث: يحذف قيده (بفحوص الإقفال والتسوية البنكية) ويعيد الشيك قائماً؛ التراجع عن التسجيل يحذف الشيك. */
export async function undoLastEvent(tenantId: string, id: string) {
  const cheque = await getCheque(tenantId, id);
  const last = cheque.events[cheque.events.length - 1];
  if (!last) throw badRequest("لا توجد حركة للتراجع عنها");
  await prisma.$transaction(async (tx) => {
    await tx.chequeEvent.delete({ where: { id: last.id } });
    await deleteJournalEntryTx(tx, last.journalEntryId);
    if (last.type === "registered") {
      await tx.cheque.delete({ where: { id } });
    } else {
      await tx.cheque.update({ where: { id }, data: { status: "pending", ...(last.type === "cleared" ? { bankAccountId: null } : {}) } });
    }
  });
  return last.type === "registered" ? null : getCheque(tenantId, id);
}
