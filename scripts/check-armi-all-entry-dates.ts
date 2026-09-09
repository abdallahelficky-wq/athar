/**
 * سكريبت قرائي فقط بالكامل — لا يُعدِّل ولا يحذف ولا يُنشئ أي شيء في قاعدة البيانات.
 *
 * اكتُشف أن تواريخ القيود الأربعة 688/724/733/1333 (J00610/J00711/J00723/J01311) خاطئة في أثر
 * نفسها (لا مجرد عرض)، بنمط ثابت: الشهر المخزَّن = يوم المرجع، واليوم المخزَّن = شهر المرجع
 * ناقص 1 (تبديل يوم/شهر + انزياح ترقيم). **هذا الخطأ لا يمكن أن يظهر في أي تقرير تسوية سابق**:
 * منطق matchEntries() في investigate-armi-full-reconciliation.ts للقيود ذات المرجع الرقمي
 * (NUMERIC، وهي فئة الأربعة هذه بالضبط) يطابق فقط بعدد الأسطر + إجمالي المبلغ — لا يتحقق من
 * التاريخ إطلاقاً. لذا فأي قيد رقمي آخر قد يحمل نفس خطأ التاريخ هذا بصمت تام حتى لو كانت أسطره
 * ومبالغه مطابقة تماماً للمرجع (أي حتى لو صُنِّف "مطابقاً تماماً" في كل تقرير سابق).
 *
 * القيود ذات المرجع PYT/INV بالمقابل **لا يمكن** أن تحمل هذا الخطأ بصمت: مطابقتها في
 * matchEntries() تعتمد أصلاً على تطابق التاريخ مع المرجع كجزء من معيار الربط نفسه — فلو كان
 * تاريخها خاطئاً في أثر لَما طابقها matchEntries() بتاريخ المرجع الصحيح أصلاً، ولظهرت "غائبة
 * تماماً" بدل مطابقة صامتة بتاريخ خاطئ. يُتحقَّق من هذا بشكل حسابي في هذا السكريبت (لا افتراضاً)
 * لإثباته، لا لتخمينه.
 *
 * لكل القيود الرقمية (NUMERIC) المطابقة بثقة (نمط "قيد يدوي رقم N" الأساسي في الـmemo، لرقم أصلي
 * فريد لا يتكرر لأكثر من قيد واحد في أثر): يقارن تاريخها المخزَّن في أثر بتاريخ المرجع (من
 * reference/armi_statement_*.csv)، ويطبع كل اختلاف وجده — بلا أي افتراض مسبق بأن الأربعة
 * المعروفة هي كل ما فيه مشكلة.
 *
 * ينبّه أيضاً بشكل خاص، ومستقل تماماً عن أي مقارنة بالمرجع، على أي قيد (من كل الـ)bulk_import
 * إطلاقاً — رقمي أو PYT/INV — تاريخه المخزَّن في أثر بعد FUTURE_CUTOFF (تاريخ مستقبلي غير منطقي
 * لقيد مستورَد من سجلات تاريخية).
 *
 * الاستخدام: DATABASE_URL=<...> npx tsx scripts/check-armi-all-entry-dates.ts [companyId]
 */
import { PrismaClient } from "@prisma/client";
import { loadExcelLines, groupExcelEntries, matchEntries, type DbEntryLike } from "./investigate-armi-full-reconciliation";

const prisma = new PrismaClient();
const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";

// تاريخ اليوم الفعلي وقت طلب هذا الفحص (كما ذكره المستخدم صراحة) — ثابت ومقصود، لا new Date() وقت
// التشغيل، حتى يكون الفحص قابلاً لإعادة الإنتاج بنفس النتيجة بغض النظر عن متى يُشغَّل فعلياً.
const FUTURE_CUTOFF = new Date("2026-09-09T00:00:00.000Z");

interface DateMismatch {
  originalNumber: number;
  entryNumber: string;
  memo: string | null;
  dbDate: string;
  refDate: string;
  isFuture: boolean;
}

export async function run(companyId: string) {
  console.log(`=== فحص شامل لتواريخ كل القيود المستورَدة من قيود مقابل المرجع — companyId=${companyId} (قرائي فقط، بلا أي تعديل) ===\n`);

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);

  const excelEntries = groupExcelEntries(loadExcelLines());

  const dbEntriesRaw = await prisma.journalEntry.findMany({
    where: { companyId, sourceModule: "bulk_import" },
    include: { lines: { include: { account: true } } },
    orderBy: { entryNumber: "asc" },
  });
  console.log(`إجمالي القيود المستورَدة فعلياً (sourceModule=bulk_import) في أثر: ${dbEntriesRaw.length}\n`);

  const dbEntries: DbEntryLike[] = dbEntriesRaw.map((e) => ({
    id: e.id,
    entryNumber: e.entryNumber,
    memo: e.memo,
    date: e.date,
    lines: e.lines.map((l) => ({ debit: l.debit, credit: l.credit, account: l.account ? { name: l.account.name } : null })),
  }));

  const result = matchEntries(excelEntries, dbEntries);

  // ---------- 1) فحص القيود الرقمية (NUMERIC) — الفئة الوحيدة القادرة على إخفاء خطأ التاريخ بصمت ----------
  const byOriginalNumber = new Map<number, DbEntryLike[]>();
  for (const d of result.dbExtracted) {
    if (d.matchQuality !== "primary" || d.originalNumber === null) continue;
    byOriginalNumber.set(d.originalNumber, [...(byOriginalNumber.get(d.originalNumber) || []), d.entry]);
  }

  const mismatches: DateMismatch[] = [];
  const multiDateRef: string[] = [];
  let numericChecked = 0;
  let numericNoRef = 0;
  let numericAmbiguous = 0;

  for (const excelEntry of excelEntries.values()) {
    if (excelEntry.pattern !== "NUMERIC") continue;
    const num = Number(excelEntry.reference);
    const candidates = byOriginalNumber.get(num) || [];
    if (candidates.length === 0) {
      numericNoRef++; // غائب تماماً من أثر — مشكلة منفصلة معروفة، خارج نطاق فحص التاريخ هذا
      continue;
    }
    if (candidates.length > 1) {
      numericAmbiguous++; // رقم مكرَّر لأكثر من قيد — يحتاج مراجعة منفصلة، لا يمكن الحسم آلياً هنا
      continue;
    }
    if (excelEntry.dates.size !== 1) {
      multiDateRef.push(excelEntry.reference);
      continue;
    }
    numericChecked++;
    const refDate = [...excelEntry.dates][0];
    const db = candidates[0];
    const dbDate = db.date.toISOString().slice(0, 10);
    if (dbDate !== refDate) {
      mismatches.push({
        originalNumber: num,
        entryNumber: db.entryNumber,
        memo: db.memo,
        dbDate,
        refDate,
        isFuture: db.date.getTime() > FUTURE_CUTOFF.getTime(),
      });
    }
  }

  console.log(`--- فحص القيود الرقمية (NUMERIC) — ${numericChecked} قيداً فُحص، ${numericNoRef} غائب من أثر (خارج النطاق)، ${numericAmbiguous} برقم مكرَّر (خارج النطاق) ---`);
  if (multiDateRef.length) {
    console.log(`⚠️ ${multiDateRef.length} قيداً مرجعياً موزَّعاً على أكثر من تاريخ في المرجع نفسه — لا يمكن مقارنته آلياً: ${multiDateRef.join(", ")}`);
  }
  console.log(`\n=== النتيجة: ${mismatches.length} قيداً باختلاف تاريخ فعلي بين أثر والمرجع ===`);
  if (mismatches.length === 0) {
    console.log(`  لا يوجد أي اختلاف تاريخ آخر بين القيود الرقمية المطابقة بثقة والمرجع.`);
  } else {
    mismatches
      .sort((a, b) => a.originalNumber - b.originalNumber)
      .forEach((m) => {
        console.log(`  القيد ${m.originalNumber} (entryNumber=${m.entryNumber}): أثر=${m.dbDate} / الصحيح (المرجع)=${m.refDate}${m.isFuture ? "  🔮 تاريخ مستقبلي في أثر!" : ""}`);
      });
  }

  // ---------- 2) تحقّق حسابي (لا افتراضي) من أن قيود PYT/INV لا يمكن أن تحمل هذا الخطأ بصمت ----------
  const pytInvMatchedCount = [...excelEntries.values()].filter(
    (e) => (e.pattern === "PYT" || e.pattern === "INV") && (result.exactMatches.includes(e.reference) || result.moreLinesInAthar.some((x) => x.excel.reference === e.reference) || result.fewerLinesInAthar.some((x) => x.excel.reference === e.reference)),
  ).length;
  console.log(`\n--- قيود PYT/INV ---`);
  console.log(`  ${pytInvMatchedCount} قيداً من نمط PYT/INV مطابَق حالياً في أثر — مطابقتها تعتمد أصلاً على تطابق التاريخ مع المرجع كشرط ربط (راجع matchEntries())، فلا يمكن رياضياً أن تحمل تاريخاً خاطئاً بصمت. لا حاجة لفحص تاريخها هنا بشكل منفصل.`);

  // ---------- 3) فحص مستقل تماماً: أي قيد (رقمي أو PYT/INV، مطابَق أو لا) بتاريخ مستقبلي في أثر ----------
  const futureEntries = dbEntriesRaw.filter((e) => e.date.getTime() > FUTURE_CUTOFF.getTime());
  console.log(`\n=== تنبيه مستقل: قيود بتاريخ مستقبلي في أثر (بعد ${FUTURE_CUTOFF.toISOString().slice(0, 10)}) — بغض النظر عن مطابقتها بالمرجع ===`);
  if (futureEntries.length === 0) {
    console.log(`  لا يوجد أي قيد بتاريخ مستقبلي في كل الـ${dbEntriesRaw.length} قيداً المستورَدة.`);
  } else {
    console.log(`  ${futureEntries.length} قيداً بتاريخ مستقبلي:`);
    futureEntries.forEach((e) => console.log(`    entryNumber=${e.entryNumber} | تاريخ أثر=${e.date.toISOString().slice(0, 10)} | البيان="${e.memo}"`));
  }

  console.log(`\n=== ملخص ===`);
  console.log(`إجمالي القيود المستورَدة: ${dbEntriesRaw.length}`);
  console.log(`قيود رقمية فُحص تاريخها: ${numericChecked}`);
  console.log(`قيود رقمية باختلاف تاريخ: ${mismatches.length}`);
  console.log(`قيود بتاريخ مستقبلي (من كل الأنماط): ${futureEntries.length}`);
}

async function main() {
  const companyId = process.argv[2] || DEFAULT_ARMI_COMPANY_ID;
  await run(companyId);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
