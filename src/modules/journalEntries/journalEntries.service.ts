import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/password";
import { badRequest, forbidden, notFound } from "../../lib/httpError";

const BALANCE_EPSILON = 0.01;

export interface JournalLineInput {
  accountId: string;
  costCenterId?: string | null;
  department?: string | null;
  debit: number;
  credit: number;
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
}

export interface JournalEntryInput {
  companyId: string;
  date: Date;
  memo?: string;
  lines: JournalLineInput[];
}

/** القاعدة الصارمة المطلوبة صراحة في القسم 3 من المستند: مجموع المدين = مجموع الدائن قبل أي حفظ */
function assertBalanced(lines: JournalLineInput[]) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);

  if (lines.length < 2) throw badRequest("القيد يجب أن يحتوي على سطرين على الأقل");
  if (totalDebit <= 0) throw badRequest("إجمالي القيد يجب أن يكون أكبر من صفر");
  if (Math.abs(totalDebit - totalCredit) > BALANCE_EPSILON) {
    throw badRequest("القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن", { totalDebit, totalCredit });
  }
}

async function assertReferencesBelongToTenant(tenantId: string, input: JournalEntryInput) {
  const company = await prisma.company.findFirst({ where: { id: input.companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, tenantId } });
  if (accounts.length !== accountIds.length) throw badRequest("أحد الحسابات المستخدمة في القيد غير موجود");

  const costCenterIds = [...new Set(input.lines.map((l) => l.costCenterId).filter(Boolean))] as string[];
  if (costCenterIds.length) {
    const costCenters = await prisma.costCenter.findMany({ where: { id: { in: costCenterIds }, tenantId } });
    if (costCenters.length !== costCenterIds.length) throw badRequest("أحد مراكز التكلفة المستخدمة غير موجود");
  }
}

function toLineCreateData(lines: JournalLineInput[]) {
  return lines.map((l) => ({
    accountId: l.accountId,
    costCenterId: l.costCenterId || null,
    department: l.department || null,
    debit: new Prisma.Decimal(l.debit || 0),
    credit: new Prisma.Decimal(l.credit || 0),
    customerId: l.customerId || null,
    supplierId: l.supplierId || null,
    employeeId: l.employeeId || null,
  }));
}

const entryInclude = {
  lines: { include: { account: true, costCenter: true } },
  company: true,
} satisfies Prisma.JournalEntryInclude;

export async function listJournalEntries(
  tenantId: string,
  filters: { companyId?: string; dateFrom?: string; dateTo?: string; search?: string },
) {
  return prisma.journalEntry.findMany({
    where: {
      tenantId,
      companyId: filters.companyId || undefined,
      date: {
        gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
      },
      ...(filters.search
        ? { OR: [{ memo: { contains: filters.search, mode: "insensitive" } }, { id: filters.search }] }
        : {}),
    },
    include: entryInclude,
    orderBy: { date: "desc" },
  });
}

export async function getJournalEntry(tenantId: string, id: string) {
  const entry = await prisma.journalEntry.findFirst({ where: { id, tenantId }, include: entryInclude });
  if (!entry) throw notFound("القيد غير موجود");
  return entry;
}

export async function createJournalEntry(tenantId: string, userId: string, input: JournalEntryInput) {
  assertBalanced(input.lines);
  await assertReferencesBelongToTenant(tenantId, input);

  return prisma.journalEntry.create({
    data: {
      tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: input.memo,
      status: "posted",
      sourceModule: "manual",
      createdBy: userId,
      lines: { create: toLineCreateData(input.lines) },
    },
    include: entryInclude,
  });
}

export async function updateJournalEntry(tenantId: string, id: string, input: JournalEntryInput) {
  const existing = await prisma.journalEntry.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("القيد غير موجود");
  if (existing.status !== "draft") {
    throw badRequest("لا يمكن تعديل قيد مرحّل، يجب فك ترحيله أولاً");
  }

  assertBalanced(input.lines);
  await assertReferencesBelongToTenant(tenantId, input);

  return prisma.$transaction(async (tx) => {
    await tx.journalEntryLine.deleteMany({ where: { journalEntryId: id } });
    return tx.journalEntry.update({
      where: { id },
      data: {
        companyId: input.companyId,
        date: input.date,
        memo: input.memo,
        lines: { create: toLineCreateData(input.lines) },
      },
      include: entryInclude,
    });
  });
}

export async function deleteJournalEntry(tenantId: string, id: string) {
  const existing = await prisma.journalEntry.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("القيد غير موجود");
  if (existing.status !== "draft") {
    throw badRequest("لا يمكن حذف قيد مرحّل، يجب فك ترحيله أولاً");
  }
  await prisma.journalEntry.delete({ where: { id } });
}

export async function postJournalEntry(tenantId: string, id: string) {
  const existing = await prisma.journalEntry.findFirst({ where: { id, tenantId }, include: entryInclude });
  if (!existing) throw notFound("القيد غير موجود");
  if (existing.status === "posted") throw badRequest("القيد مرحّل بالفعل");

  assertBalanced(
    existing.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })),
  );

  return prisma.journalEntry.update({ where: { id }, data: { status: "posted" }, include: entryInclude });
}

export async function unpostJournalEntry(tenantId: string, id: string, userId: string, pin: string) {
  const entry = await prisma.journalEntry.findFirst({ where: { id, tenantId } });
  if (!entry) throw notFound("القيد غير موجود");
  if (entry.status !== "posted") throw badRequest("القيد ليس مرحّلاً أصلاً");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const validPin = await verifyPassword(pin, tenant.unlockPin);
  if (!validPin) throw forbidden("الرقم السري غير صحيح");

  const [updated] = await prisma.$transaction([
    prisma.journalEntry.update({ where: { id }, data: { status: "draft" }, include: entryInclude }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "journal_entry.unpost",
        entityType: "JournalEntry",
        entityId: id,
        metadata: { previousStatus: "posted" },
      },
    }),
  ]);

  return updated;
}

export interface ImportRow {
  date: string;
  memo?: string;
  debitAccountName: string;
  debitAmount: number;
  creditAccountName: string;
  creditAmount: number;
}

export async function importJournalEntries(tenantId: string, userId: string, companyId: string, rows: ImportRow[]) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");

  const accounts = await prisma.account.findMany({ where: { tenantId } });
  const accountByName = new Map(accounts.map((a) => [a.name, a]));

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const debitAccount = accountByName.get(row.debitAccountName);
    const creditAccount = accountByName.get(row.creditAccountName);
    const debitAmt = Number(row.debitAmount || 0);
    const creditAmt = Number(row.creditAmount || 0);

    if (
      !row.date ||
      !debitAccount ||
      !creditAccount ||
      debitAmt <= 0 ||
      Math.abs(debitAmt - creditAmt) > BALANCE_EPSILON
    ) {
      skipped++;
      continue;
    }

    await prisma.journalEntry.create({
      data: {
        tenantId,
        companyId,
        date: new Date(row.date),
        memo: row.memo,
        status: "posted",
        sourceModule: "manual",
        createdBy: userId,
        lines: {
          create: [
            { accountId: debitAccount.id, debit: new Prisma.Decimal(debitAmt), credit: new Prisma.Decimal(0) },
            { accountId: creditAccount.id, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(creditAmt) },
          ],
        },
      },
    });
    imported++;
  }

  return { imported, skipped };
}
