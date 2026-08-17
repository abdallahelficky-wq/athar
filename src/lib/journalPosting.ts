import { Prisma, PrismaClient, SourceModule } from "@prisma/client";
import { prisma } from "./prisma";
import { verifyPassword } from "./password";
import { badRequest, forbidden, notFound } from "./httpError";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * تحجز الرقم التسلسلي التالي لقيد جديد ضمن شركة معيّنة، بصيغة [بادئة الشركة][5 خانات]
 * (مثال TP00001) — عبر زيادة ذرّية (UPDATE ... RETURNING) على عدّاد الشركة نفسها ضمن نفس
 * معاملة إنشاء القيد (tx)، فلا يُحجز الرقم فعلياً إلا لحظة الكتابة الفعلية في قاعدة البيانات؛
 * لو المعاملة فشلت أو أُلغيت العملية قبل الوصول لهذه النقطة، لا يتأثر العدّاد إطلاقاً ولا تظهر
 * فجوة (Gap) في التسلسل. تبدأ بادئة كل شركة افتراضياً بالحرف J ويمكن تعديلها من بيانات الشركة.
 */
export async function reserveEntryNumber(tx: Tx, tenantId: string, companyId: string): Promise<string> {
  const company = await tx.company.findFirst({ where: { id: companyId, tenantId }, select: { numberingPrefix: true } });
  if (!company) throw notFound("الشركة غير موجودة");

  // نُرجِع القيمة *قبل* الزيادة (وهي بالضبط ما تعرضه previewNextEntryNumber أدناه من نفس العمود)،
  // بينما العمود المخزَّن يصبح +1 جاهزاً للاستدعاء التالي — عملية ذرّية واحدة عبر تعبير حسابي في
  // RETURNING بدل قراءة ثم تحديث منفصلَين، فيبقى الرقم المحجوز مطابقاً تماماً لما عاينه المستخدم.
  const rows = await tx.$queryRaw<{ nextJournalEntrySeq: number }[]>`
    UPDATE "companies" SET "nextJournalEntrySeq" = "nextJournalEntrySeq" + 1
    WHERE "id" = ${companyId} AND "tenantId" = ${tenantId}
    RETURNING "nextJournalEntrySeq" - 1 AS "nextJournalEntrySeq"
  `;
  const seq = rows[0]?.nextJournalEntrySeq;
  if (seq == null) throw notFound("الشركة غير موجودة");
  return `${company.numberingPrefix}${String(seq).padStart(5, "0")}`;
}

/** معاينة الرقم التالي المتوقع بلا أي حجز أو تعديل على العدّاد — للعرض في نافذة إضافة قيد قبل الحفظ فقط */
export async function previewNextEntryNumber(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId },
    select: { numberingPrefix: true, nextJournalEntrySeq: true },
  });
  if (!company) throw notFound("الشركة غير موجودة");
  return { prefix: company.numberingPrefix, preview: `${company.numberingPrefix}${String(company.nextJournalEntrySeq).padStart(5, "0")}` };
}

export interface PostingLine {
  accountId: string;
  costCenterId?: string | null;
  department?: string | null;
  debit: number;
  credit: number;
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  fixedAssetId?: string | null;
  employeeAdvanceId?: string | null;
}

export interface CreateEntryInput {
  tenantId: string;
  companyId: string;
  date: Date;
  memo?: string;
  sourceModule: SourceModule;
  sourceId?: string;
  createdBy?: string;
  lines: PostingLine[];
}

/**
 * ينشئ قيداً محاسبياً مرحّلاً (status: posted) من أسطر جاهزة — يُستخدَم من كل موديولات
 * المصادر (فواتير، سندات، رواتب، إهلاك...) عوضاً عن تكرار نفس منطق الإنشاء في كل موديول.
 * لا يتحقق من توازن المدين/الدائن هنا لأن كل موديول يبني أسطره بشكل متوازن رياضياً
 * بالتصميم (مطابقةً لمنطق الواجهة المرجعية)؛ التحقق الصارم موجود فقط في القيود اليدوية
 * الحرة الشكل (journalEntries.service.ts) حيث يُدخل المستخدم الأرقام يدوياً.
 */
export async function createJournalEntryTx(tx: Tx, input: CreateEntryInput) {
  const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
  const companyAccounts = await tx.account.count({
    where: {
      id: { in: accountIds },
      tenantId: input.tenantId,
      companyId: input.companyId,
      isPosting: true,
      isActive: true,
      isArchived: false,
    },
  });
  if (companyAccounts !== accountIds.length) {
    throw badRequest("أحد حسابات القيد لا ينتمي إلى شجرة الشركة أو ليس حساب ترحيل نشطاً");
  }

  const entryNumber = await reserveEntryNumber(tx, input.tenantId, input.companyId);
  return tx.journalEntry.create({
    data: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: input.memo,
      status: "posted",
      entryNumber,
      sourceModule: input.sourceModule,
      sourceId: input.sourceId,
      createdBy: input.createdBy,
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId || null,
          department: l.department || null,
          debit: new Prisma.Decimal(l.debit || 0),
          credit: new Prisma.Decimal(l.credit || 0),
          customerId: l.customerId || null,
          supplierId: l.supplierId || null,
          employeeId: l.employeeId || null,
          fixedAssetId: l.fixedAssetId || null,
          employeeAdvanceId: l.employeeAdvanceId || null,
        })),
      },
    },
  });
}

/** يحذف القيد المرتبط بمعاملة مصدر (فاتورة/سند/...) عند فك ترحيلها، وفق القسم 4.9 */
export async function deleteJournalEntryTx(tx: Tx, journalEntryId: string | null | undefined) {
  if (!journalEntryId) return;
  await tx.journalEntry.deleteMany({ where: { id: journalEntryId } });
}

/** يتحقق من الرقم السري لفك الترحيل الخاص بالمستأجر، ويرمي خطأ 403 إن كان خاطئاً */
export async function assertValidUnlockPin(tenantId: string, pin: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const valid = await verifyPassword(pin, tenant.unlockPin);
  if (!valid) throw forbidden("الرقم السري غير صحيح");
}

/** يسجّل حدث فك ترحيل في سجل التدقيق (audit log) وفق ما يطلبه القسم 4.9 صراحة */
export async function writeUnpostAuditLogTx(
  tx: Tx,
  params: { tenantId: string; userId: string; entityType: string; entityId: string; metadata?: Record<string, unknown> },
) {
  await tx.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: `${params.entityType.toLowerCase()}.unpost`,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata as Prisma.InputJsonValue,
    },
  });
}
