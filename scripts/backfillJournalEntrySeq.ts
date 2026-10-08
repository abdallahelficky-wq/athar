/**
 * تعبئة رجعية لعمود JournalEntry.entrySeq (أُضيف في migration
 * 20261005130000_add_journal_entry_entry_seq) لكل القيود الموجودة قبل إضافة العمود.
 *
 * قاعدة الاستخراج (الصيغة الوحيدة التي يُنتجها كود التطبيق الحالي، في كل من reserveEntryNumber في
 * journalPosting.ts وbulkImport.service.ts): بادئة من حرف أو حرفين إنجليزيين كبيرين (A-Z) تماماً،
 * متبوعة مباشرة بخانات رقمية فقط، بلا أي فاصل أو حرف آخر — ^([A-Z]{1,2})(\d+)$. الجزء الرقمي
 * يُستخرَج كـentrySeq عبر parseInt.
 *
 * أي entryNumber لا يطابق هذه الصيغة تماماً (قيود قديمة مستوردة من نظام آخر كـQoyod بصيغة مختلفة،
 * أو أي حالة غير متوقَّعة) يبقى entrySeq له NULL — لا تُخمَّن القيمة ولا تُطرَح صفراً أبداً. الـNULL
 * نفسه مدعوم بالكامل في الترتيب (nulls آخر الترتيب دائماً، انظر buildKeysetWhere).
 *
 * الاستخدام:
 *   export DATABASE_URL="<neon-branch-or-production-url>"
 *   npx tsx scripts/backfillJournalEntrySeq.ts                # تقرير Dry-run فقط — يطبع عدد
 *                                                              # القيود القابلة للتفسير وغير
 *                                                              # القابلة للتفسير (مع عيّنة قيم غير
 *                                                              # القابلة للتفسير لكل شركة). لا يعدّل شيئاً.
 *   npx tsx scripts/backfillJournalEntrySeq.ts --commit        # تنفيذ فعلي: يكتب entrySeq لكل
 *                                                              # القيود القابلة للتفسير فقط، ثم
 *                                                              # يتحقق من عدم وجود قيم entrySeq
 *                                                              # مكرَّرة ضمن أي شركة، ويطبع كل ذلك.
 *
 * يتطلب أن يكون migration 20261005130000_add_journal_entry_entry_seq مُطبَّقاً فعلاً (عمود entrySeq
 * موجود) قبل التشغيل — نفّذ `npx prisma migrate deploy` أولاً.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const commit = process.argv.includes("--commit");

// نفس الصيغة بالضبط: بادئة حرف/حرفين كبيرين إنجليزيين، ثم خانات رقمية فقط، بلا أي شيء آخر.
const ENTRY_NUMBER_PATTERN = /^[A-Z]{1,2}(\d+)$/;

function parseEntrySeq(entryNumber: string): number | null {
  const match = ENTRY_NUMBER_PATTERN.exec(entryNumber);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function reportUnparseable() {
  const entries = await prisma.journalEntry.findMany({
    select: { id: true, entryNumber: true, companyId: true, company: { select: { name: true } } },
  });

  const parseable: { id: string; entrySeq: number }[] = [];
  const unparseableByCompany = new Map<string, { companyName: string; samples: string[]; count: number }>();

  for (const entry of entries) {
    const seq = parseEntrySeq(entry.entryNumber);
    if (seq != null) {
      parseable.push({ id: entry.id, entrySeq: seq });
      continue;
    }
    const bucket = unparseableByCompany.get(entry.companyId) ?? {
      companyName: entry.company.name,
      samples: [],
      count: 0,
    };
    bucket.count += 1;
    if (bucket.samples.length < 10) bucket.samples.push(entry.entryNumber);
    unparseableByCompany.set(entry.companyId, bucket);
  }

  return { total: entries.length, parseable, unparseableByCompany };
}

async function countDuplicateEntrySeq(): Promise<{ companyId: string; entrySeq: number; count: bigint }[]> {
  return prisma.$queryRaw<{ companyId: string; entrySeq: number; count: bigint }[]>`
    SELECT "companyId", "entrySeq", COUNT(*) AS count
    FROM "journal_entries"
    WHERE "entrySeq" IS NOT NULL
    GROUP BY "companyId", "entrySeq"
    HAVING COUNT(*) > 1
  `;
}

async function main() {
  console.log(`[backfillJournalEntrySeq.ts] mode=${commit ? "COMMIT — تنفيذ فعلي" : "DRY-RUN — عرض فقط، بلا أي تعديل"}`);

  const { total, parseable, unparseableByCompany } = await reportUnparseable();
  const unparseableTotal = total - parseable.length;

  console.log(`إجمالي القيود: ${total}`);
  console.log(`قابلة للتفسير (ستُكتَب entrySeq لها): ${parseable.length}`);
  console.log(`غير قابلة للتفسير (ستبقى entrySeq=NULL): ${unparseableTotal}`);

  if (unparseableByCompany.size > 0) {
    console.log("\nتفصيل غير القابلة للتفسير لكل شركة (عيّنة حتى 10 قيم):");
    for (const [companyId, bucket] of unparseableByCompany) {
      console.log(`  - ${bucket.companyName} (${companyId}): ${bucket.count} قيد — أمثلة: ${bucket.samples.join(", ")}`);
    }
  }

  if (!commit) {
    console.log("\n[DRY-RUN] لم يُعدَّل أي شيء. راجع الأرقام أعلاه (خصوصاً عيّنات غير القابلة للتفسير) ثم أضف --commit.");
    return;
  }

  console.log(`\n[COMMIT] كتابة entrySeq لـ ${parseable.length} قيداً قابلاً للتفسير...`);
  // تحديث فردي عبر $transaction واحد (لا updateMany لأن كل قيد له entrySeq مختلف) — عدد القيود
  // الحالي (~1800) يسمح بذلك ضمن معاملة واحدة؛ لو كبر الحجم مستقبلاً يستحق تقسيمها لدفعات.
  const BATCH_SIZE = 500;
  for (let i = 0; i < parseable.length; i += BATCH_SIZE) {
    const batch = parseable.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((row) => prisma.journalEntry.update({ where: { id: row.id }, data: { entrySeq: row.entrySeq } })),
    );
  }

  const afterReport = await reportUnparseable();
  const afterUnparseableTotal = afterReport.total - afterReport.parseable.length;
  console.log(`\nعدد القيود غير القابلة للتفسير بعد الكتابة: ${afterUnparseableTotal} (المتوقَّع: ${unparseableTotal})`);

  const duplicates = await countDuplicateEntrySeq();
  console.log(`عدد قيم entrySeq المكرَّرة ضمن أي شركة: ${duplicates.length}`);
  if (duplicates.length > 0) {
    console.error("تحذير: توجد قيم entrySeq مكرَّرة ضمن شركة واحدة — راجعها يدوياً قبل أي خطوة لاحقة:");
    console.error(duplicates);
    process.exitCode = 1;
    return;
  }

  if (afterUnparseableTotal !== unparseableTotal) {
    console.error("تحذير: عدد غير القابلة للتفسير تغيّر بين القراءة والكتابة — راجع يدوياً (تعديل متزامن محتمل).");
    process.exitCode = 1;
    return;
  }

  console.log("التحقق نجح: كل القيود القابلة للتفسير كُتبت بلا تكرار، وغير القابلة للتفسير بقيت NULL كما هو متوقَّع.");
}

main()
  .catch((err) => {
    console.error("خطأ غير متوقع:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
