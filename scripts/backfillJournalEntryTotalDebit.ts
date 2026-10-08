/**
 * تعبئة رجعية لعمود JournalEntry.totalDebit (أُضيف في migration
 * 20261005120000_add_journal_entry_total_debit) لكل القيود الموجودة من قبل إضافة العمود — المرحلة 1
 * من ميزة ترقيم صفحات دفتر اليومية. يُعيد الحساب عبر recomputeEntryTotal نفسها من journalPosting.ts
 * (الشكل الجماعي، مصفوفة معرّفات) — نفس الدالة المستخدَمة في كل مسارات الكتابة الحالية في التطبيق،
 * فلا يوجد أي منطق حساب مختلف أو مكرَّر هنا.
 *
 * يتطلب أن يكون migration 20261005120000_add_journal_entry_total_debit مُطبَّقاً فعلاً على قاعدة
 * البيانات الهدف (عمود totalDebit موجود) قبل تشغيل هذا السكريبت — نفّذ `npx prisma migrate deploy`
 * أولاً.
 *
 * الاستخدام:
 *   export DATABASE_URL="<neon-branch-or-production-url>"
 *   npx tsx scripts/backfillJournalEntryTotalDebit.ts                # تقرير Dry-run فقط — يطبع
 *                                                                     # عدد القيود التي totalDebit
 *                                                                     # فيها لا يطابق SUM(lines.debit)
 *                                                                     # الفعلي حالياً. لا يعدّل شيئاً.
 *   npx tsx scripts/backfillJournalEntryTotalDebit.ts --commit        # تنفيذ فعلي: إعادة حساب
 *                                                                     # totalDebit لكل القيود دفعة
 *                                                                     # واحدة، ثم إعادة فحص التطابق
 *                                                                     # فوراً ويجب أن يطبع صفراً.
 *
 * لا يُشغَّل بعلامة --commit على بيانات إنتاج حقيقية إلا بعد تشغيله (dry-run ثم commit) أولاً على
 * فرع Neon منسوخ من الإنتاج، والتأكد أن عدد التعارضات بعد --commit هو صفر تماماً.
 *
 * ملاحظة حجم: يُنفَّذ إعادة الحساب بعبارة SQL واحدة عبر unnest لكل معرّفات القيود معاً (لا استعلام
 * منفصل لكل قيد) — مناسب للحجم الحالي (~1800 قيد). لو كبر عدد القيود لعشرات/مئات الآلاف مستقبلاً،
 * ربما يستحق الأمر تقسيمها لدفعات (batches) بدل عبارة واحدة على كل الجدول.
 */
import { PrismaClient } from "@prisma/client";
import { recomputeEntryTotal } from "../src/lib/journalPosting";

const prisma = new PrismaClient();
const commit = process.argv.includes("--commit");

async function countMismatches(): Promise<number> {
  const rows = await prisma.$queryRaw<{ mismatches: bigint }[]>`
    SELECT COUNT(*) AS mismatches
    FROM "journal_entries" je
    LEFT JOIN (
      SELECT "journalEntryId", SUM(debit) AS total
      FROM "journal_entry_lines"
      GROUP BY "journalEntryId"
    ) sub ON sub."journalEntryId" = je.id
    WHERE je."totalDebit" IS DISTINCT FROM COALESCE(sub.total, 0)
  `;
  return Number(rows[0]?.mismatches ?? 0);
}

async function main() {
  console.log(`[backfillJournalEntryTotalDebit.ts] mode=${commit ? "COMMIT — تنفيذ فعلي" : "DRY-RUN — عرض فقط، بلا أي تعديل"}`);

  const totalEntries = await prisma.journalEntry.count();
  const mismatchesBefore = await countMismatches();
  console.log(`إجمالي القيود: ${totalEntries}`);
  console.log(`القيود التي totalDebit فيها لا يطابق مجموع أسطرها الفعلي حالياً: ${mismatchesBefore}`);

  if (!commit) {
    console.log("\n[DRY-RUN] لم يُعدَّل أي شيء. أضف --commit للتنفيذ الفعلي بعد مراجعة الأرقام أعلاه.");
    return;
  }

  if (mismatchesBefore === 0) {
    console.log("\nلا حاجة لأي تعديل — كل القيود متوافقة بالفعل.");
    return;
  }

  const ids = (await prisma.journalEntry.findMany({ select: { id: true } })).map((e) => e.id);
  console.log(`\n[COMMIT] إعادة حساب totalDebit لـ ${ids.length} قيداً...`);
  await recomputeEntryTotal(prisma, ids);

  const mismatchesAfter = await countMismatches();
  console.log(`عدد القيود غير المتطابقة بعد إعادة الحساب: ${mismatchesAfter}`);
  if (mismatchesAfter === 0) {
    console.log("التحقق نجح: totalDebit يطابق SUM(lines.debit) لكل قيد بلا استثناء.");
  } else {
    console.error("تحذير: ما زال هناك قيود غير متطابقة بعد إعادة الحساب — يجب فحصها يدوياً قبل أي خطوة لاحقة.");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("خطأ غير متوقع:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
