import { Prisma, PrismaClient, SourceModule } from "@prisma/client";
import { prisma } from "./prisma";
import { verifyPassword } from "./password";
import { badRequest, forbidden, notFound } from "./httpError";
import { assertPeriodNotClosed, lockCompanyClosingDate } from "./fiscalClosing";

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
 * بما أن هذه الدالة هي نقطة العبور شبه الوحيدة لإنشاء أي قيد في النظام (كل الوحدات المُدرجة أعلى
 * الملف عبر createJournalEntryTx، بالإضافة لكل مسارات القيود اليدوية في journalEntries.service.ts)،
 * فهي المكان الطبيعي للتحقق من إقفال السنة المالية أيضاً — عبر تضمين fiscalYearClosingDate في نفس
 * عبارة UPDATE...RETURNING الذرّية (لا استعلام إضافي، ولا نافذة سباق: القيمة المُعادة هي بالضبط ما
 * قفله الصف وقت هذا التحديث، وأي محاولة إقفال متزامنة أخرى ستنتظر حتى تنتهي معاملتنا)، وهي أيضاً
 * مصدر الحقيقة الوحيد لكلا القيمتين معاً (entryNumber المنسَّق وentrySeq الخام) — أي مسار إنشاء
 * قيد منفرد جديد يستدعيها هنا فقط، لا يُعيد تنسيق/اشتقاق أي منهما بنفسه. المسار الوحيد المستثنى هو
 * الاستيراد الجماعي (bulkImport.service.ts) الذي يحجز كتلة كاملة من الأرقام بعملية ذرّية واحدة
 * بدل رقم منفرد لكل قيد (انظر تعليقه هناك) — فيبني entryNumber/entrySeq بنفس المنطق الحسابي بالضبط
 * (بادئة + رقم تسلسلي خام) محلياً، بلا استدعاء هذه الدالة، لأسباب أداء فقط لا اختلافاً في التعريف،
 * ويتحقق من إقفال السنة المالية بنفسه بنفس الأسلوب (انظر bulkImport.service.ts).
 */
export async function reserveEntryNumber(tx: Tx, tenantId: string, companyId: string, date: Date): Promise<ReservedEntryNumber> {
  // نُرجِع القيمة *قبل* الزيادة (وهي بالضبط ما تعرضه previewNextEntryNumber أدناه من نفس العمود)،
  // بينما العمود المخزَّن يصبح +1 جاهزاً للاستدعاء التالي — عملية ذرّية واحدة عبر تعبير حسابي في
  // RETURNING بدل قراءة ثم تحديث منفصلَين، فيبقى الرقم المحجوز مطابقاً تماماً لما عاينه المستخدم.
  const rows = await tx.$queryRaw<{ nextJournalEntrySeq: number; numberingPrefix: string; fiscalYearClosingDate: Date | null }[]>`
    UPDATE "companies" SET "nextJournalEntrySeq" = "nextJournalEntrySeq" + 1
    WHERE "id" = ${companyId} AND "tenantId" = ${tenantId}
    RETURNING "nextJournalEntrySeq" - 1 AS "nextJournalEntrySeq", "numberingPrefix", "fiscalYearClosingDate"
  `;
  const row = rows[0];
  if (!row) throw notFound("الشركة غير موجودة");
  // يُتحقَّق هنا بعد التحديث فعلياً (لا قبله) — أي رفض يُرجع كل المعاملة بالكامل تلقائياً
  // (Prisma تتراجع عن كل شيء عند رمي أي خطأ داخل $transaction)، فلا يُستهلك رقم تسلسلي بلا قيد.
  assertPeriodNotClosed(row.fiscalYearClosingDate, date, "إنشاء قيد");
  return { entryNumber: `${row.numberingPrefix}${String(row.nextJournalEntrySeq).padStart(5, "0")}`, entrySeq: row.nextJournalEntrySeq };
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
  // وصف السطر — باسم مستقل عمداً: أسطر مستندات كثيرة تحمل حقل description لأغراضها، وتمريره تلقائياً كان
  // سيبدأ بتخزين نصوص لم تُقصَد في أسطر القيود. يمرّره من يطلبه صراحةً فقط (الرواتب بالإجماليات).
  lineDescription?: string | null;
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

  const { entryNumber, entrySeq } = await reserveEntryNumber(tx, input.tenantId, input.companyId, input.date);
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
          description: l.lineDescription || null,
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

/**
 * يحذف القيد المرتبط بمعاملة مصدر (فاتورة/سند/...) عند فك ترحيلها، وفق القسم 4.9 — هذه هي نقطة
 * العبور شبه الوحيدة لحذف/فك ترحيل قيد في كل الوحدات المصدرية (خلاف القيود اليدوية الحرة، المفحوصة
 * باستقلالية في journalEntries.service.ts). تتحقق أولاً من تاريخ القيد الفعلي مقابل إقفال السنة
 * المالية قبل أي حذف — بقفل صفّ الشركة (`FOR UPDATE`) طوال بقية هذه المعاملة، فلا يمكن لأي معاملة
 * أخرى تُغيّر تاريخ الإقفال أن "تتسلل" بين لحظة التحقق ولحظة الحذف الفعلي.
 */
export async function deleteJournalEntryTx(tx: Tx, journalEntryId: string | null | undefined) {
  if (!journalEntryId) return;
  const entry = await tx.journalEntry.findUnique({ where: { id: journalEntryId }, select: { date: true, companyId: true } });
  if (!entry) return;

  const closingDate = await lockCompanyClosingDate(tx, entry.companyId);
  assertPeriodNotClosed(closingDate, entry.date, "حذف/فك ترحيل قيد");

  await tx.journalEntry.deleteMany({ where: { id: journalEntryId } });
}

export const UNLOCK_PIN_MAX_FAILED_ATTEMPTS = 5;
export const UNLOCK_PIN_LOCK_MINUTES = 15;

/**
 * يتحقق من الرقم السري لفك الترحيل الخاص بالمستأجر، لمستخدم بعينه. كل محاولة خاطئة تُكتَب في سجل
 * التدقيق باسم المستخدم (unlock_pin.failed)، وبعد 5 محاولات خاطئة متتالية يُقفَل فك الترحيل لهذا
 * المستخدم 15 دقيقة (403 بلا التحقق من الرقم أصلاً طوال القفل). المحاولة الصحيحة تُصفّر العدّاد.
 * القفل لكل مستخدم لا للمستأجر كله: فلا يستطيع مستخدم واحد تعطيل فك الترحيل على زملائه.
 *
 * تُكتَب العدّادات وصف التدقيق عبر prisma مباشرة (لا tx المستدعي) عمداً: كل المستدعين يتحققون قبل
 * بدء معاملتهم، والخطأ الذي يليها مباشرة لا يجب أن يُلغي تسجيل المحاولة الفاشلة نفسها.
 */
export async function assertValidUnlockPin(tenantId: string, pin: string, userId: string) {
  const user = await prisma.user.findFirstOrThrow({
    where: { id: userId, tenantId },
    select: { unlockPinLockedUntil: true },
  });
  const now = new Date();
  if (user.unlockPinLockedUntil && user.unlockPinLockedUntil > now) {
    const minutes = Math.ceil((user.unlockPinLockedUntil.getTime() - now.getTime()) / 60_000);
    throw forbidden(`فك الترحيل مقفل مؤقتاً بعد محاولات خاطئة متكررة للرقم السري — حاول بعد ${minutes} دقيقة`);
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { unlockPin: true } });
  if (await verifyPassword(pin, tenant.unlockPin)) {
    await prisma.user.updateMany({ where: { id: userId, unlockPinFailedAttempts: { gt: 0 } }, data: { unlockPinFailedAttempts: 0 } });
    return;
  }

  const { unlockPinFailedAttempts: attempts } = await prisma.user.update({
    where: { id: userId },
    data: { unlockPinFailedAttempts: { increment: 1 } },
    select: { unlockPinFailedAttempts: true },
  });
  const locked = attempts >= UNLOCK_PIN_MAX_FAILED_ATTEMPTS;
  const lockedUntil = locked ? new Date(now.getTime() + UNLOCK_PIN_LOCK_MINUTES * 60_000) : null;
  if (locked) {
    await prisma.user.update({ where: { id: userId }, data: { unlockPinFailedAttempts: 0, unlockPinLockedUntil: lockedUntil } });
  }
  await prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action: "unlock_pin.failed",
      entityType: "User",
      entityId: userId,
      metadata: { attempt: attempts, locked, lockedUntil: lockedUntil?.toISOString() ?? null },
    },
  });
  if (locked) {
    throw forbidden(`الرقم السري غير صحيح — قُفل فك الترحيل ${UNLOCK_PIN_LOCK_MINUTES} دقيقة بعد ${UNLOCK_PIN_MAX_FAILED_ATTEMPTS} محاولات خاطئة`);
  }
  throw forbidden("الرقم السري غير صحيح");
}

/** يسجّل حدث فك ترحيل في سجل التدقيق (audit log) وفق ما يطلبه القسم 4.9 صراحة، مع شركة المستند كعمود
 * عادي. مسارات "الإزالة" التي تحذف المستند نفسه قبل هذا الاستدعاء (دفعات الإهلاك، السُّلف، الأصول
 * الثابتة، حركات المخزون) تمرّر companyId صراحةً من السجل المُحمَّل قبل الحذف؛ وإلا تُقرأ الشركة من
 * المستند نفسه (كل entityType مُمرَّر هنا نموذج Prisma يحمل companyId، واسم مفوّضه = entityType بحرف
 * أول صغير). */
export async function writeUnpostAuditLogTx(
  tx: Tx,
  params: { tenantId: string; userId: string; entityType: string; entityId: string; companyId?: string; metadata?: Record<string, unknown> },
) {
  if (params.companyId) {
    await writeUnpostAuditRow(tx, params, params.companyId);
    return;
  }
  const delegateName = params.entityType[0].toLowerCase() + params.entityType.slice(1);
  const delegate = (tx as unknown as Record<string, { findUnique?: (args: unknown) => Promise<{ companyId: string } | null> }>)[delegateName];
  const document = await delegate?.findUnique?.({ where: { id: params.entityId }, select: { companyId: true } });
  await writeUnpostAuditRow(tx, params, document?.companyId ?? null);
}

async function writeUnpostAuditRow(
  tx: Tx,
  params: { tenantId: string; userId: string; entityType: string; entityId: string; metadata?: Record<string, unknown> },
  companyId: string | null,
) {
  await tx.auditLog.create({
    data: {
      tenantId: params.tenantId,
      companyId,
      userId: params.userId,
      action: `${params.entityType.toLowerCase()}.unpost`,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata as Prisma.InputJsonValue,
    },
  });
}
