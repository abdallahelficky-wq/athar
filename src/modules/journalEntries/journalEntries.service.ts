import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/password";
import { badRequest, forbidden, notFound } from "../../lib/httpError";
import { extractJournalEntryFromDocument } from "../../lib/claudeVision";
import { buildObjectKey, uploadObject, getPresignedGetUrl } from "../../lib/storage";

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
  return { ...entry, mirrorEntry: await resolveMirrorEntry(tenantId, entry.mirrorEntryId) };
}

/** يحل المرجع الحر mirrorEntryId يدوياً (بلا include صريح، بنفس أسلوب sourceId/sourceModule) لعرض ملخص القيد المرتبط في الشركة الأخرى */
async function resolveMirrorEntry(tenantId: string, mirrorEntryId: string | null) {
  if (!mirrorEntryId) return null;
  const mirror = await prisma.journalEntry.findFirst({
    where: { id: mirrorEntryId, tenantId },
    include: { company: true },
  });
  if (!mirror) return null;
  return {
    id: mirror.id,
    companyId: mirror.companyId,
    companyName: mirror.company.shortName || mirror.company.name,
    date: mirror.date,
    memo: mirror.memo,
    status: mirror.status,
  };
}

/**
 * تُنشئ (أو تُعيد) حساب "ذمم بين الشركات" الممثّل لشركة `forCompanyId` ضمن نفس المستأجر — يُستخدَم
 * هذا الحساب من أي شركة أخرى في المستأجر تتعامل مالياً مع forCompanyId. تُفضَّل المطابقة عبر
 * intercompanyCompanyId المُعرَّف صراحة (بنية FK، صامدة أمام إعادة تسمية الشركة لاحقاً)، وإن لم
 * يوجد تُنشأ تلقائياً حساباً جديداً باسم مُشتق — طبقاً للتفويض الصريح المسبق من المستخدم بالإنشاء
 * التلقائي عند عدم وجود هذه الحسابات في شجرة الحسابات.
 */
export async function ensureIntercompanyAccount(tenantId: string, forCompanyId: string) {
  const company = await prisma.company.findFirst({ where: { id: forCompanyId, tenantId } });
  if (!company) throw badRequest("الشركة الشقيقة غير موجودة ضمن مستأجرك");

  const existingByTag = await prisma.account.findFirst({ where: { tenantId, intercompanyCompanyId: forCompanyId } });
  if (existingByTag) return existingByTag;

  const name = `ذمم بين الشركات - ${company.shortName || company.name}`;
  const existingByName = await prisma.account.findFirst({ where: { tenantId, name } });
  if (existingByName) {
    return prisma.account.update({ where: { id: existingByName.id }, data: { intercompanyCompanyId: forCompanyId } });
  }

  return prisma.account.create({
    data: { tenantId, name, type: "asset", intercompanyCompanyId: forCompanyId },
  });
}

/**
 * تُعِدّ اقتراح "قيد المرآة" في شركة أخرى: تحدّد سطر "الطرف الآخر" تلقائياً (الحساب الممثّل للشركة
 * المصدر داخل شجرة حسابات الشركة الهدف) بعكس الاتجاه (مدين↔دائن)، وتترك سطراً آخر فارغاً ليختار
 * المستخدم منه الحساب الفعلي يدوياً (لأنه يختلف بحسب طبيعة العملية ولا يمكن تخمينه). عند عدم وجود
 * سطر مرتبط صراحة بحساب الشركة الهدف (وهو المتوقع أول مرة يُنشأ فيها قيد مرآة بين شركتين، قبل أن
 * توجد الحسابات المُعلَّمة)، تُستخدَم القيمة الإجمالية للقيد كبديل مع الإشارة لذلك عبر detected:false.
 */
export async function getMirrorSuggestion(tenantId: string, entryId: string, targetCompanyId: string) {
  const entry = await prisma.journalEntry.findFirst({ where: { id: entryId, tenantId }, include: entryInclude });
  if (!entry) throw notFound("القيد غير موجود");
  if (entry.status !== "posted") throw badRequest("لا يمكن إنشاء قيد مرآة إلا لقيد مرحّل");
  if (entry.companyId === targetCompanyId) throw badRequest("اختر شركة مختلفة عن شركة القيد الأصلي");

  const targetCompany = await prisma.company.findFirst({ where: { id: targetCompanyId, tenantId } });
  if (!targetCompany) throw badRequest("الشركة المستهدفة غير موجودة ضمن مستأجرك");

  const sourceSideAccountForTarget = await ensureIntercompanyAccount(tenantId, entry.companyId);
  await ensureIntercompanyAccount(tenantId, targetCompanyId);

  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
  const linkedLine = entry.lines.find((l) => l.account.intercompanyCompanyId === targetCompanyId);

  let autoSide: "debit" | "credit";
  let amount: number;
  if (linkedLine) {
    amount = Number(linkedLine.debit) || Number(linkedLine.credit);
    const originalSideWasDebit = Number(linkedLine.debit) > 0;
    autoSide = originalSideWasDebit ? "credit" : "debit";
  } else {
    amount = totalDebit;
    autoSide = "credit";
  }

  const autoLine = {
    accountId: sourceSideAccountForTarget.id,
    accountName: sourceSideAccountForTarget.name,
    debit: autoSide === "debit" ? amount : 0,
    credit: autoSide === "credit" ? amount : 0,
    locked: true,
  };
  const manualLine = {
    accountId: null,
    accountName: null,
    debit: autoSide === "credit" ? amount : 0,
    credit: autoSide === "debit" ? amount : 0,
    locked: false,
  };

  return {
    targetCompanyId,
    date: entry.date,
    memo: entry.memo,
    lines: [autoLine, manualLine],
    detected: !!linkedLine,
  };
}

/**
 * تُنشئ قيد المرآة فعلياً في الشركة المستهدفة كمسودة (لا يُرحَّل تلقائياً أبداً، ليراجعه المستخدم قبل
 * الترحيل) وتربطه بالقيد الأصلي تبادلياً عبر mirrorEntryId على القيدين معاً ضمن معاملة واحدة.
 */
export async function createMirrorJournalEntry(
  tenantId: string,
  userId: string,
  sourceEntryId: string,
  input: { targetCompanyId: string; date: Date; memo?: string; lines: JournalLineInput[] },
) {
  const source = await prisma.journalEntry.findFirst({ where: { id: sourceEntryId, tenantId } });
  if (!source) throw notFound("القيد الأصلي غير موجود");
  if (source.mirrorEntryId) throw badRequest("لهذا القيد بالفعل قيد مرآة مرتبط به");
  if (source.companyId === input.targetCompanyId) throw badRequest("اختر شركة مختلفة عن شركة القيد الأصلي");

  assertBalanced(input.lines);
  await assertReferencesBelongToTenant(tenantId, {
    companyId: input.targetCompanyId,
    date: input.date,
    memo: input.memo,
    lines: input.lines,
  });

  return prisma.$transaction(async (tx) => {
    const mirror = await tx.journalEntry.create({
      data: {
        tenantId,
        companyId: input.targetCompanyId,
        date: input.date,
        memo: input.memo,
        status: "draft",
        sourceModule: "manual",
        createdBy: userId,
        mirrorEntryId: sourceEntryId,
        lines: { create: toLineCreateData(input.lines) },
      },
      include: entryInclude,
    });
    await tx.journalEntry.update({ where: { id: sourceEntryId }, data: { mirrorEntryId: mirror.id } });
    return mirror;
  });
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

/**
 * إنشاء قيد يومية "مسودة" من مستند (صورة/PDF) بمساعدة الذكاء الاصطناعي — يقرأ Claude
 * المستند ويقترح حساباً مديناً ودائناً من شجرة حسابات هذا المستأجر فعلياً، ثم يُنشأ القيد
 * بحالة draft (لا يُرحَّل أبداً تلقائياً؛ المستخدم يراجعه ويعدّله ثم يستخدم /:id/post الحالي
 * صراحة للترحيل، تماماً كأي قيد يدوي آخر). المستند المرفوع يُربَط تلقائياً بالقيد الناتج
 * عبر جدول Attachment بمجرد إنشائه.
 */
export async function createJournalEntryFromDocument(
  tenantId: string,
  userId: string,
  companyId: string,
  file: { buffer: Buffer; mimeType: string; fileName: string },
) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");

  const accounts = await prisma.account.findMany({ where: { tenantId, isActive: true } });
  const extraction = await extractJournalEntryFromDocument(
    file.buffer,
    file.mimeType,
    accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
  );

  const accountIds = new Set(accounts.map((a) => a.id));
  if (
    !extraction.suggestedDebitAccountId ||
    !extraction.suggestedCreditAccountId ||
    !accountIds.has(extraction.suggestedDebitAccountId) ||
    !accountIds.has(extraction.suggestedCreditAccountId)
  ) {
    throw badRequest("تعذّر على الذكاء الاصطناعي اقتراح حساب صالح من شجرة حساباتك لهذا المستند، جرّب مستنداً أوضح أو أنشئ القيد يدوياً");
  }
  if (extraction.suggestedDebitAccountId === extraction.suggestedCreditAccountId) {
    throw badRequest("اقترح الذكاء الاصطناعي نفس الحساب مديناً ودائناً معاً، وهذا غير منطقي محاسبياً — راجع المستند وأنشئ القيد يدوياً");
  }
  if (extraction.amount <= 0) {
    throw badRequest("تعذّر على الذكاء الاصطناعي قراءة مبلغ صالح من هذا المستند");
  }

  const lines: JournalLineInput[] = [
    { accountId: extraction.suggestedDebitAccountId, debit: extraction.amount, credit: 0 },
    { accountId: extraction.suggestedCreditAccountId, debit: 0, credit: extraction.amount },
  ];
  assertBalanced(lines);

  const memoParts = [extraction.description || "قيد مقترح من مستند بالذكاء الاصطناعي"];
  if (extraction.partyName) memoParts.push(`— ${extraction.partyName}`);
  if (extraction.vatAmount > 0) memoParts.push(`(شامل ضريبة قيمة مضافة: ${extraction.vatAmount.toFixed(2)} ر.س)`);

  const date = extraction.date && !Number.isNaN(Date.parse(extraction.date)) ? new Date(extraction.date) : new Date();

  const entry = await prisma.journalEntry.create({
    data: {
      tenantId,
      companyId,
      date,
      memo: memoParts.join(" "),
      status: "draft",
      sourceModule: "ai_document",
      createdBy: userId,
      lines: { create: toLineCreateData(lines) },
    },
    include: entryInclude,
  });

  const fileKey = buildObjectKey(tenantId, "journal_entry", entry.id, file.fileName);
  await uploadObject(fileKey, file.buffer, file.mimeType);
  const attachment = await prisma.attachment.create({
    data: {
      tenantId,
      entityType: "journal_entry",
      entityId: entry.id,
      fileName: file.fileName,
      fileKey,
      fileSize: file.buffer.length,
      mimeType: file.mimeType,
      uploadedBy: userId,
    },
  });

  return {
    entry,
    attachment: { id: attachment.id, fileName: attachment.fileName, fileUrl: await getPresignedGetUrl(fileKey) },
    aiConfidenceNote: extraction.confidenceNote,
  };
}
