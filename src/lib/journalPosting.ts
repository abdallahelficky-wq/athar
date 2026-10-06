import { Prisma, PrismaClient, SourceModule } from "@prisma/client";
import { prisma } from "./prisma";
import { verifyPassword } from "./password";
import { badRequest, forbidden, notFound } from "./httpError";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface ReservedEntryNumber {
  entryNumber: string;
  // الرقم التسلسلي الخام (قبل إضافة البادئة/الحشو) — مصدره الوحيد هذه الدالة بالضبط؛ كل مستدعٍ
  // يحفظه في JournalEntry.entrySeq عند الإنشاء بدل إعادة استخراجه لاحقاً من النص entryNumber (الذي
  // قد تتغيّر بادئته أو يتجاوز طوله 5 خانات، فيصبح استخراج الرقم من النص غير موثوق — انظر
  // entrySeq في schema.prisma). يبقى entryNumber النصي هو المعروض للمستخدم دائماً، لا entrySeq.
  entrySeq: number;
}

/**
 * تحجز الرقم التسلسلي التالي لقيد جديد ضمن شركة معيّنة، بصيغة [بادئة الشركة][5 خانات]
 * (مثال TP00001) — عبر زيادة ذرّية (UPDATE ... RETURNING) على عدّاد الشركة نفسها ضمن نفس
 * معاملة إنشاء القيد (tx)، فلا يُحجز الرقم فعلياً إلا لحظة الكتابة الفعلية في قاعدة البيانات؛
 * لو المعاملة فشلت أو أُلغيت العملية قبل الوصول لهذه النقطة، لا يتأثر العدّاد إطلاقاً ولا تظهر
 * فجوة (Gap) في التسلسل. تبدأ بادئة كل شركة افتراضياً بالحرف J ويمكن تعديلها من بيانات الشركة.
 *
 * مصدر الحقيقة الوحيد لكلا القيمتين معاً (entryNumber المنسَّق وentrySeq الخام) — أي مسار إنشاء
 * قيد منفرد جديد يستدعيها هنا فقط، لا يُعيد تنسيق/اشتقاق أي منهما بنفسه. المسار الوحيد المستثنى هو
 * الاستيراد الجماعي (bulkImport.service.ts) الذي يحجز كتلة كاملة من الأرقام بعملية ذرّية واحدة
 * بدل رقم منفرد لكل قيد (انظر تعليقه هناك) — فيبني entryNumber/entrySeq بنفس المنطق الحسابي بالضبط
 * (بادئة + رقم تسلسلي خام) محلياً، بلا استدعاء هذه الدالة، لأسباب أداء فقط لا اختلافاً في التعريف.
 */
export async function reserveEntryNumber(tx: Tx, tenantId: string, companyId: string): Promise<ReservedEntryNumber> {
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
  return { entryNumber: `${company.numberingPrefix}${String(seq).padStart(5, "0")}`, entrySeq: seq };
}

/**
 * مصدر الحقيقة الوحيد لقيمة JournalEntry.totalDebit — تُعيد حسابها دائماً من واقع الأسطر
 * المخزَّنة فعلياً (SUM(debit) عبر aggregate)، ولا تُشتَق أبداً من قيمة محسوبة مسبقاً في الذاكرة أو
 * بزيادة تراكمية (increment). يجب استدعاؤها في نهاية أي معاملة تُنشئ أو تُعدّل أو تحذف سطراً واحداً
 * أو أكثر من أسطر قيد معيّن (بعد اكتمال كل التعديلات على الأسطر ضمن نفس tx)، قبل أي return — هذا
 * يضمن بقاء العمود مطابقاً تماماً للأسطر الفعلية بصرف النظر عن مسار الكتابة (قيد يدوي، قيد تلقائي
 * من موديول مصدر، قيد مرآة/عكس، أو استيراد جماعي)، ويجعل أي مسار جديد مستقبلاً يحتاج استدعاءً واحداً
 * فقط بدل إعادة تنفيذ منطق الجمع بنفسه.
 *
 * تقبل معرّف قيد واحد، أو مصفوفة معرّفات لإعادة الحساب دفعة واحدة بعملية SQL واحدة (بدل استدعاء
 * منفصل لكل قيد) — ضروري لمسار الاستيراد الجماعي الذي قد يُنشئ آلاف القيود ضمن معاملة واحدة محدودة
 * بمهلة زمنية، حيث تتحول آلاف الرحلات المتتابعة (aggregate + update لكل قيد) لعنق زجاجة حقيقي.
 * الحسابان (المفرد والجماعي) يستخدمان نفس التعريف بالضبط: SUM(debit) من journal_entry_lines.
 */
export async function recomputeEntryTotal(tx: Tx, entryIdOrIds: string | string[]): Promise<void> {
  if (Array.isArray(entryIdOrIds)) {
    if (entryIdOrIds.length === 0) return;
    // LEFT JOIN عبر unnest بدل الربط المباشر بـ sub (الذي لا يحتوي أصلاً أي صف لقيد بلا أسطر) —
    // حتى يُصفَّر totalDebit بشكل صريح أيضاً لو حُذفت كل أسطر أحد القيود ضمن هذه المجموعة، لا أن
    // يُترَك بقيمته القديمة.
    await tx.$executeRaw`
      UPDATE "journal_entries" je
      SET "totalDebit" = COALESCE(sub.total, 0)
      FROM unnest(${entryIdOrIds}::text[]) AS ids(id)
      LEFT JOIN (
        SELECT "journalEntryId", SUM(debit) AS total
        FROM "journal_entry_lines"
        GROUP BY "journalEntryId"
      ) sub ON sub."journalEntryId" = ids.id
      WHERE je.id = ids.id
    `;
    return;
  }

  const { _sum } = await tx.journalEntryLine.aggregate({
    where: { journalEntryId: entryIdOrIds },
    _sum: { debit: true },
  });
  await tx.journalEntry.update({
    where: { id: entryIdOrIds },
    data: { totalDebit: _sum.debit ?? new Prisma.Decimal(0) },
  });
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
  // فرع اختياري على مستوى المستند المصدر بالكامل — يُمرَّر فقط من الموديولات التي تحمل تصنيف فرع
  // فعلياً (حالياً فواتير المبيعات/المشتريات)؛ بقية المصادر (سندات، رواتب، إهلاك...) لا تمرّره
  // فيبقى null كسابقاً. القيد نفسه لا يحمل فرعاً بعد الآن (انظر JournalEntryLine.branchId) —
  // القيمة هنا تُنسَخ على كل سطر يُنشأ ضمن هذا القيد، لأن فاتورة واحدة تنتمي لفرع واحد بالكامل.
  branchId?: string | null;
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

  const { entryNumber, entrySeq } = await reserveEntryNumber(tx, input.tenantId, input.companyId);
  const entry = await tx.journalEntry.create({
    data: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      date: input.date,
      memo: input.memo,
      status: "posted",
      entryNumber,
      entrySeq,
      sourceModule: input.sourceModule,
      sourceId: input.sourceId,
      createdBy: input.createdBy,
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId || null,
          department: l.department || null,
          branchId: input.branchId || null,
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
  // بعض المستدعين (فواتير المشتريات) يُضيفون أسطراً إضافية لهذا القيد بعد هذه النقطة مباشرة ضمن
  // نفس tx (انظر createInventorySideEffectsTx) — فيستدعون recomputeEntryTotal مرة ثانية بعدها هم
  // أنفسهم؛ الاستدعاء هنا يضمن القيمة الصحيحة فوراً للمستدعين الذين لا يضيفون أسطراً إضافية (الأغلبية).
  await recomputeEntryTotal(tx, entry.id);
  return entry;
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
