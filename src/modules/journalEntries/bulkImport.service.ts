import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/httpError";

const BALANCE_EPSILON = 0.01;
// صيغة التاريخ الوحيدة المقبولة: YYYY-MM-DD (مطابقة لما يُطبِّعه normalizeDate في الواجهة، ولنمط
// bulkImport.service.ts نفسه). رفض صريح لأي صيغة أخرى (مثل DD/MM/YYYY) بدل تخمين الترتيب — تخمين
// خاطئ لتاريخ مالي أخطر بكثير من رفضه وطلب تصحيحه يدوياً في الملف المصدر.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseGroupDate(dateStr: string): Date | null {
  if (!ISO_DATE_RE.test(dateStr.trim())) return null;
  const parsed = new Date(dateStr.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface BulkImportRow {
  groupKey: string;
  date: string;
  memo: string;
  accountName: string;
  debit: number;
  credit: number;
  note: string;
}

interface EntryGroup {
  groupKey: string;
  date: string;
  memo: string;
  rows: BulkImportRow[];
}

function groupRows(rows: BulkImportRow[]): EntryGroup[] {
  const byGroup = new Map<string, EntryGroup>();
  for (const row of rows) {
    let group = byGroup.get(row.groupKey);
    if (!group) {
      group = { groupKey: row.groupKey, date: row.date, memo: row.memo, rows: [] };
      byGroup.set(row.groupKey, group);
    }
    group.rows.push(row);
  }
  return [...byGroup.values()];
}

function findUnbalancedGroups(groups: EntryGroup[]) {
  return groups
    .map((g) => {
      const totalDebit = g.rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = g.rows.reduce((s, r) => s + r.credit, 0);
      return { groupKey: g.groupKey, date: g.date, memo: g.memo, totalDebit, totalCredit, diff: totalDebit - totalCredit };
    })
    .filter((g) => Math.abs(g.diff) > BALANCE_EPSILON);
}

/** يعرض كل قيد تاريخه غير قابل للتحويل (صيغة مختلفة عن YYYY-MM-DD، أو تاريخ غير موجود فعلياً مثل
 * 2023-13-45) — قبل أي محاولة كتابة، لا بعدها. راجع تعليق parseGroupDate أعلاه لسبب الرفض الصريح
 * بدل التخمين. */
function findInvalidDateGroups(groups: EntryGroup[]) {
  return groups.filter((g) => parseGroupDate(g.date) === null).map((g) => ({ groupKey: g.groupKey, date: g.date, memo: g.memo }));
}

async function assertCompany(tenantId: string, companyId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
  if (!company) throw badRequest("الشركة المحددة غير موجودة ضمن مستأجرك");
  return company;
}

/**
 * يحلّل الصفوف المرفوعة دون أي كتابة في قاعدة البيانات: يطابق كل اسم حساب فريد بأسماء حسابات
 * الترحيل الفعلية في شجرة الشركة (مطابقة نصية دقيقة فقط بعد إزالة الفراغات الزائدة — لا تخمين
 * أو مطابقة جزئية، حتى لا يُربط سطر بحساب خاطئ بصمت)، ويتحقق من توازن كل قيد على حدة، ليعرضهما
 * المستخدم في شاشة مراجعة قبل أي التزام فعلي.
 */
export async function previewBulkImport(tenantId: string, companyId: string, rows: BulkImportRow[]) {
  await assertCompany(tenantId, companyId);

  const accounts = await prisma.account.findMany({
    where: { tenantId, companyId, isPosting: true, isArchived: false, isActive: true },
    select: { id: true, code: true, name: true },
  });
  const byName = new Map<string, typeof accounts>();
  for (const account of accounts) {
    const key = account.name.trim();
    byName.set(key, [...(byName.get(key) || []), account]);
  }

  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const key = row.accountName.trim();
    occurrences.set(key, (occurrences.get(key) || 0) + 1);
  }

  const accountNames = [...occurrences.entries()]
    .map(([name, count]) => {
      const candidates = byName.get(name) || [];
      const status: "matched" | "ambiguous" | "unmatched" =
        candidates.length === 1 ? "matched" : candidates.length === 0 ? "unmatched" : "ambiguous";
      return {
        name,
        occurrences: count,
        status,
        matchedAccountId: status === "matched" ? candidates[0].id : null,
        candidates: candidates.map((c) => ({ id: c.id, code: c.code, name: c.name })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  const groups = groupRows(rows);
  const unbalancedGroups = findUnbalancedGroups(groups);
  const invalidDateGroups = findInvalidDateGroups(groups);

  return {
    totalRows: rows.length,
    totalGroups: groups.length,
    accountNames,
    unbalancedGroups,
    invalidDateGroups,
  };
}

/**
 * يلتزم فعلياً بالاستيراد بعد مراجعة المستخدم لكل الأسماء غير المؤكدة/غير المتطابقة — يُعيد التحقق
 * من كل شيء من الصفر (توازن كل قيد، اكتمال الربط، انتماء كل حساب مُختار لشجرة هذه الشركة تحديداً)
 * بدل الوثوق بأن الواجهة أرسلت نفس بيانات المعاينة دون تعديل. القيود تُحفظ بحالة "محفوظ" (غير
 * مرحّلة) دائماً — تُراجَع وتُرحَّل يدوياً من شاشة القيود بعد الاستيراد، تماماً كأي قيد يدوي آخر.
 */
export async function commitBulkImport(
  tenantId: string,
  userId: string,
  companyId: string,
  rows: BulkImportRow[],
  accountMapping: Record<string, string>,
) {
  await assertCompany(tenantId, companyId);

  const groups = groupRows(rows);
  const unbalanced = findUnbalancedGroups(groups);
  if (unbalanced.length) {
    throw badRequest(
      `${unbalanced.length} قيد غير متوازن (مدين ≠ دائن)، أول قيد غير متوازن: رقم ${unbalanced[0].groupKey} — لا يمكن استيراد أي قيد قبل إصلاح كل القيود غير المتوازنة`,
    );
  }

  // يجب رفض أي تاريخ غير صالح هنا صراحة، قبل أي محاولة new Date() لاحقة — تمرير قيمة غير صالحة إلى
  // Prisma.createMany لاحقاً يرمي PrismaClientValidationError تُضمِّن نسخة كاملة من كل السطور
  // المُدخَلة في رسالة الخطأ نفسها (سلوك Prisma موثَّق فعلياً بالاختبار)، ما تسبب سابقاً في إغراق
  // سجلات الإنتاج بعشرات آلاف الأسطر لخطأ واحد فقط. رسالة الخطأ هنا مختصرة عمداً (رقم القيد الأول
  // فقط)، لا قائمة كاملة — القائمة الكاملة تظهر فقط في استجابة المعاينة (previewBulkImport) حتى
  // يراجعها المستخدم في الواجهة، لا في سجل الخادم.
  const invalidDates = findInvalidDateGroups(groups);
  if (invalidDates.length) {
    throw badRequest(
      `${invalidDates.length} قيد بتاريخ غير صالح (يجب أن يكون بصيغة YYYY-MM-DD)، أول قيد: رقم ${invalidDates[0].groupKey} بتاريخ "${invalidDates[0].date}" — لا يمكن استيراد أي قيد قبل تصحيح كل التواريخ غير الصالحة`,
    );
  }

  const distinctNames = [...new Set(rows.map((r) => r.accountName.trim()))];
  const missing = distinctNames.filter((name) => !accountMapping[name]);
  if (missing.length) {
    throw badRequest(`لم يتم ربط الحسابات التالية بحساب فعلي بعد: ${missing.join("، ")}`);
  }

  const mappedAccountIds = [...new Set(Object.values(accountMapping))];
  const validAccounts = await prisma.account.count({
    where: { id: { in: mappedAccountIds }, tenantId, companyId, isPosting: true, isArchived: false, isActive: true },
  });
  if (validAccounts !== mappedAccountIds.length) {
    throw badRequest("أحد الحسابات المختارة للربط لم يعد موجوداً أو غير صالح للترحيل في شجرة هذه الشركة");
  }

  return prisma.$transaction(
    async (tx) => {
      // حجز كتلة كاملة من الأرقام التسلسلية بعملية ذرّية واحدة بدل حجز رقم منفصل لكل قيد (قد
      // تصل لآلاف القيود) — نفس الدرس المستفاد من مشكلة انتهاء مهلة تسجيل الشركات (P2028) سابقاً
      // في هذا المشروع: رحلة شبكة واحدة أفضل من مئات/آلاف الرحلات المتتابعة. يجب أن يبقى هذا
      // الحجز ضمن نفس معاملة الإدراج الفعلي (لا قبلها كاستدعاء منفصل) وإلا فأي فشل لاحق (حتى لو
      // غير متعلق بقاعدة البيانات إطلاقاً) يحرق أرقاماً محجوزة نهائياً بلا أي قيد يستخدمها —
      // بالضبط الفجوة التي صُمم نمط الحجز الذرّي في journalPosting.ts أصلاً لتفاديها.
      const reserved = await tx.$queryRaw<{ startSeq: number; numberingPrefix: string }[]>`
        UPDATE "companies" SET "nextJournalEntrySeq" = "nextJournalEntrySeq" + ${groups.length}
        WHERE "id" = ${companyId} AND "tenantId" = ${tenantId}
        RETURNING ("nextJournalEntrySeq" - ${groups.length})::int AS "startSeq", "numberingPrefix"
      `;
      const startSeq = reserved[0]?.startSeq;
      const prefix = reserved[0]?.numberingPrefix;
      if (startSeq == null || !prefix) throw notFound("الشركة غير موجودة");

      const entryRows: Prisma.JournalEntryCreateManyInput[] = [];
      const lineRows: Prisma.JournalEntryLineCreateManyInput[] = [];

      groups.forEach((group, index) => {
        const entryId = randomUUID();
        const entryNumber = `${prefix}${String(startSeq + index).padStart(5, "0")}`;
        // آمن دائماً هنا: تحقّقنا مسبقاً أعلاه (findInvalidDateGroups) أن كل تاريخ في groups صالح —
        // parseGroupDate لا يمكن أن تُعيد null لأي عنصر وصل لهذه النقطة.
        entryRows.push({
          id: entryId,
          tenantId,
          companyId,
          date: parseGroupDate(group.date)!,
          memo: group.memo || null,
          status: "saved",
          entryNumber,
          sourceModule: "bulk_import",
          createdBy: userId,
        });
        for (const row of group.rows) {
          const accountId = accountMapping[row.accountName.trim()];
          lineRows.push({
            id: randomUUID(),
            journalEntryId: entryId,
            accountId,
            description: row.note || null,
            debit: new Prisma.Decimal(row.debit || 0),
            credit: new Prisma.Decimal(row.credit || 0),
          });
        }
      });

      await tx.journalEntry.createMany({ data: entryRows });
      await tx.journalEntryLine.createMany({ data: lineRows });

      return { importedEntries: entryRows.length, importedLines: lineRows.length };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
