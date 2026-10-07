import { Prisma, PrismaClient } from "@prisma/client";

/**
 * مفصولة عمداً عن journalPosting.ts (التي تستورد src/lib/prisma.ts، وبالتبعية src/config/env.ts
 * وكل متغيّرات البيئة التي يتطلّبها — JWT_ACCESS_SECRET وغيرها، لا DATABASE_URL فقط) — حتى تبقى
 * قابلة للاستيراد من سكريبتات مستقلة (مثال: scripts/create-armi-missing-entries.ts) التي تحمل
 * عميل Prisma خاصاً بها عمداً ولا تريد أي اعتماد على تهيئة التطبيق الكاملة. هذا الملف لا يستورد
 * شيئاً سوى @prisma/client نفسها.
 */
export type JournalTotalsTx = Prisma.TransactionClient | PrismaClient;

/**
 * مصدر الحقيقة الوحيد لقيمة JournalEntry.totalDebit — تُعيد حسابها دائماً من واقع الأسطر
 * المخزَّنة فعلياً (SUM(debit) عبر aggregate)، ولا تُشتَق أبداً من قيمة محسوبة مسبقاً في الذاكرة أو
 * بزيادة تراكمية (increment). يجب استدعاؤها في نهاية أي معاملة تُنشئ أو تُعدّل أو تحذف سطراً واحداً
 * أو أكثر من أسطر قيد معيّن (بعد اكتمال كل التعديلات على الأسطر ضمن نفس tx)، قبل أي return — هذا
 * يضمن بقاء العمود مطابقاً تماماً للأسطر الفعلية بصرف النظر عن مسار الكتابة (قيد يدوي، قيد تلقائي
 * من موديول مصدر، قيد مرآة/عكس، استيراد جماعي، أو سكريبت تصحيح بيانات تاريخي)، ويجعل أي مسار جديد
 * مستقبلاً يحتاج استدعاءً واحداً فقط بدل إعادة تنفيذ منطق الجمع بنفسه.
 *
 * تقبل معرّف قيد واحد، أو مصفوفة معرّفات لإعادة الحساب دفعة واحدة بعملية SQL واحدة (بدل استدعاء
 * منفصل لكل قيد) — ضروري لمسار الاستيراد الجماعي الذي قد يُنشئ آلاف القيود ضمن معاملة واحدة محدودة
 * بمهلة زمنية، حيث تتحول آلاف الرحلات المتتابعة (aggregate + update لكل قيد) لعنق زجاجة حقيقي.
 * الحسابان (المفرد والجماعي) يستخدمان نفس التعريف بالضبط: SUM(debit) من journal_entry_lines.
 */
export async function recomputeEntryTotal(tx: JournalTotalsTx, entryIdOrIds: string | string[]): Promise<void> {
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
