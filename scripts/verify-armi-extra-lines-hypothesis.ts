/**
 * سكريبت تحقّق قرائي بحت — بلا أي كتابة إطلاقاً — لاختبار فرضية محدَّدة ميكانيكياً على مستوى السطر
 * الواحد، قبل الثقة بها لبناء أي سكريبت تصحيح يكتب على قاعدة بيانات الإنتاج.
 *
 * الفرضية المطلوب اختبارها بدقة: هل "الأسطر الزائدة" في القيود الإحدى عشرة المعروفة سابقاً
 * (401, 405, 496, 540, 600, 612, 627, 688, 724, 733, 1333) هي بالضبط أسطر أحد قيود PYT/INV
 * الغائبة تماماً عن أثر، مكرَّرة عدداً صحيحاً من المرات (وليس بالضرورة مرتين تحديداً — نختبر أي k)؟
 *
 * تحذير مبني على سجل هذا المشروع نفسه: fix-armi-bulk-import-data.ts (تعليق الأسطر 16-21) يوثّق أن
 * فحصاً يدوياً سابقاً للقيدين 401 و724 تحديداً (اثنان من هذه الإحدى عشرة بالضبط) خلص إلى أن "الأسطر
 * الزائدة ليست بالضرورة تكراراً حرفياً للأسطر الصحيحة لهذا القيد نفسه". هذا لا يتعارض بالضرورة مع
 * الفرضية الجديدة (كونها أسطر قيد آخر مختلف تماماً)، لكنه سبب كافٍ لعدم افتراض صحتها والتحقق منها
 * رقمياً لكل قيد من الإحدى عشرة على حدة قبل أي تصحيح فعلي.
 *
 * لا يكتب أي شيء ولا يفترض النتيجة سلفاً — يقارن الأرقام حصراً ويطبع تفصيلاً كاملاً لكل حالة، بما في
 * ذلك الحالات التي لا تتأكد فيها الفرضية، ليقرر مستخدم بشري بعد المراجعة الكاملة.
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/verify-armi-extra-lines-hypothesis.ts
 */
import { PrismaClient } from "@prisma/client";
import { loadExcelLines, groupExcelEntries, type ExcelEntry } from "./investigate-armi-full-reconciliation";

const prisma = new PrismaClient();
const ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const MEMO_ENTRY_NUMBER_RE = /قيد يدوي رقم\s*(\d+)/;
export const KNOWN_EXTRA_LINE_ENTRY_NUMBERS = [401, 405, 496, 540, 600, 612, 627, 688, 724, 733, 1333];

export interface SimpleLine {
  debit: number;
  credit: number;
  accountName: string;
  description: string | null;
}

export interface DbEntryForCheck {
  date: string;
  lines: SimpleLine[];
}

export interface HypothesisResult {
  unmatchedLines: SimpleLine[];
  unresolvedCorrectLines: { debit: number; credit: number }[];
  resolved: boolean;
  matchedReference?: string;
  matchedPattern?: string;
  multiplier?: number;
}

function amountKey(debit: number, credit: number): string {
  return `${Math.round(debit * 100)}|${Math.round(credit * 100)}`;
}

function tryConsume(counts: Map<string, number>, key: string, n: number): boolean {
  const have = counts.get(key) || 0;
  if (have < n) return false;
  counts.set(key, have - n);
  return true;
}

function buildMultiset(lines: { debit: number; credit: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    const k = amountKey(l.debit, l.credit);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// المنطق الخالص الكامل للفرضية — بلا أي قراءة ملفات أو اتصال DB، ليُعاد استخدامه حرفياً في اختبار
// محلي ببيانات تركيبية قبل تشغيله على بيانات الإنتاج الحقيقية.
export function checkExtraLinesHypothesis(dbEntry: DbEntryForCheck, correctEntry: ExcelEntry, candidates: ExcelEntry[]): HypothesisResult {
  const dbCounts = buildMultiset(dbEntry.lines);
  const unresolvedCorrectLines: { debit: number; credit: number }[] = [];
  for (const cl of correctEntry.lines) {
    const k = amountKey(cl.debit, cl.credit);
    if (!tryConsume(dbCounts, k, 1)) unresolvedCorrectLines.push({ debit: cl.debit, credit: cl.credit });
  }

  const unmatchedLines: SimpleLine[] = [];
  for (const l of dbEntry.lines) {
    const k = amountKey(l.debit, l.credit);
    const remaining = dbCounts.get(k) || 0;
    if (remaining > 0) {
      unmatchedLines.push(l);
      dbCounts.set(k, remaining - 1);
    }
  }

  if (unmatchedLines.length === 0) {
    return { unmatchedLines, unresolvedCorrectLines, resolved: true };
  }

  const unmatchedMultiset = buildMultiset(unmatchedLines);
  const unmatchedTotal = unmatchedLines.length;

  for (const candidate of candidates) {
    const candidateMultiset = buildMultiset(candidate.lines);
    const candidateTotal = candidate.lines.length;
    if (candidateTotal === 0 || unmatchedTotal % candidateTotal !== 0) continue;
    const k = unmatchedTotal / candidateTotal;
    if (k < 1 || k > 4) continue;

    let matchesExactly = true;
    for (const [key, count] of candidateMultiset) {
      if ((unmatchedMultiset.get(key) || 0) !== count * k) { matchesExactly = false; break; }
    }
    if (matchesExactly) {
      for (const [key, count] of unmatchedMultiset) {
        if ((candidateMultiset.get(key) || 0) * k !== count) { matchesExactly = false; break; }
      }
    }
    if (matchesExactly) {
      return { unmatchedLines, unresolvedCorrectLines, resolved: true, matchedReference: candidate.reference, matchedPattern: candidate.pattern, multiplier: k };
    }
  }

  return { unmatchedLines, unresolvedCorrectLines, resolved: false };
}

export interface CombinedUnitMatch {
  candidateReference: string;
  candidatePattern: string;
  multiplier: number;
}

export interface CombinedUnitResult {
  totalDbLines: number;
  matches: CombinedUnitMatch[];
}

// فرضية أدق (مقترَحة بعد أن رفضت الأرقام الفرضية الأولى 0/11): الأسطر المخزَّنة بالكامل في أثر —
// وليس فقط "الزائد" بعد طرح الصحيح مرة واحدة — هي تكرار (k مرة) لوحدة مركّبة واحدة = [كل أسطر
// القيد الصحيح] + [كل أسطر قيد PYT/INV واحد محدد]، معاً كوحدة. أي أن أسطر القيد الصحيح نفسها قد
// تتكرر k مرة أيضاً، لا مرة واحدة فقط كما افترضت الفرضية الأولى — وهذا سبب رفضها. لا تُفترَض أي
// قيمة لـk أو أي قيد PYT/INV مرشَّح سلفاً؛ تُكتشَف رقمياً بمطابقة multiset كاملة تماماً.
export function checkCombinedUnitHypothesis(dbEntry: DbEntryForCheck, correctEntry: ExcelEntry, candidates: ExcelEntry[]): CombinedUnitResult {
  const dbMultiset = buildMultiset(dbEntry.lines);
  const dbTotal = dbEntry.lines.length;
  const correctMultiset = buildMultiset(correctEntry.lines);

  const matches: CombinedUnitMatch[] = [];
  for (const candidate of candidates) {
    const combinedTotal = correctEntry.lines.length + candidate.lines.length;
    if (combinedTotal === 0 || dbTotal % combinedTotal !== 0) continue;
    const k = dbTotal / combinedTotal;
    if (k < 1 || k > 6) continue;

    const combinedMultiset = new Map(correctMultiset);
    for (const [key, count] of buildMultiset(candidate.lines)) {
      combinedMultiset.set(key, (combinedMultiset.get(key) || 0) + count);
    }

    let exact = true;
    for (const [key, count] of combinedMultiset) {
      if ((dbMultiset.get(key) || 0) !== count * k) { exact = false; break; }
    }
    if (exact) {
      for (const [key, count] of dbMultiset) {
        if ((combinedMultiset.get(key) || 0) * k !== count) { exact = false; break; }
      }
    }
    if (exact) matches.push({ candidateReference: candidate.reference, candidatePattern: candidate.pattern, multiplier: k });
  }

  return { totalDbLines: dbTotal, matches };
}

interface DbLine extends SimpleLine {
  id: string;
}
interface DbEntry {
  id: string;
  entryNumber: string | null;
  date: string;
  memo: string | null;
  lines: DbLine[];
}

async function loadDbEntries(): Promise<DbEntry[]> {
  const rows = await prisma.$queryRaw<
    { id: string; entryNumber: string | null; date: Date; memo: string | null; lineId: string; debit: unknown; credit: unknown; description: string | null; accountName: string }[]
  >`
    SELECT je.id, je."entryNumber", je.date, je.memo, jel.id AS "lineId", jel.debit, jel.credit, jel.description, a.name AS "accountName"
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel."journalEntryId" = je.id
    JOIN accounts a ON a.id = jel."accountId"
    WHERE je."companyId" = ${ARMI_COMPANY_ID} AND je."sourceModule" = 'bulk_import'
    ORDER BY je.id, jel.ctid
  `;
  const byEntryId = new Map<string, DbEntry>();
  for (const row of rows) {
    let entry = byEntryId.get(row.id);
    if (!entry) {
      entry = { id: row.id, entryNumber: row.entryNumber, date: row.date.toISOString().slice(0, 10), memo: row.memo, lines: [] };
      byEntryId.set(row.id, entry);
    }
    entry.lines.push({ id: row.lineId, debit: Number(row.debit), credit: Number(row.credit), description: row.description, accountName: row.accountName });
  }
  return [...byEntryId.values()];
}

async function main() {
  const excelLines = loadExcelLines();
  const excelEntries = groupExcelEntries(excelLines);

  const dbEntries = await loadDbEntries();
  const byOriginalNumber = new Map<number, DbEntry>();
  for (const entry of dbEntries) {
    const m = entry.memo ? MEMO_ENTRY_NUMBER_RE.exec(entry.memo) : null;
    if (!m) continue;
    const num = Number(m[1]);
    if (byOriginalNumber.has(num)) {
      console.log(`⚠️ أكثر من قيد في أثر يحمل نفس الرقم الأصلي ${num} — سيُستخدَم أولهما هنا فقط، هذه الحالة تحتاج معالجة منفصلة بمعزل عن هذا السكريبت.`);
      continue;
    }
    byOriginalNumber.set(num, entry);
  }

  const pytInvEntries = [...excelEntries.values()].filter((e) => e.pattern === "PYT" || e.pattern === "INV");

  console.log(`=== اختبار الفرضية المُنقَّحة: "كل أسطر القيد المخزَّن = تكرار (k مرة) لوحدة [القيد الصحيح + قيد PYT/INV واحد محدد] معاً" ===`);
  console.log(`(بلا أي كتابة — قراءة فقط. عدد قيود PYT/INV المتاحة كمرشَّحين: ${pytInvEntries.length})\n`);

  let confirmedCount = 0;
  let unresolvedCount = 0;

  for (const num of KNOWN_EXTRA_LINE_ENTRY_NUMBERS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`القيد الأصلي رقم ${num}`);
    console.log("=".repeat(60));

    const dbEntry = byOriginalNumber.get(num);
    if (!dbEntry) {
      console.log(`  ⚠️ لم يُعثَر عليه في أثر بهذا الرقم الأصلي (استخراج المرجع من الـmemo) — تحقق يدوياً.`);
      continue;
    }
    const correctEntry = excelEntries.get(String(num));
    if (!correctEntry) {
      console.log(`  ⚠️ لا يوجد مرجع في قيود لهذا الرقم — غير متوقَّع، تحقق يدوياً.`);
      continue;
    }

    console.log(`  تاريخ القيد في أثر: ${dbEntry.date} | تاريخ القيد في قيود: ${[...correctEntry.dates].join(",")}`);
    console.log(`  عدد الأسطر: أثر=${dbEntry.lines.length} | قيود (الصحيح)=${correctEntry.lines.length}`);

    console.log(`\n  --- الأسطر الصحيحة (من قيود) ---`);
    correctEntry.lines.forEach((l) => console.log(`    ${l.account} | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)} | ${l.description}`));

    console.log(`\n  --- الأسطر المخزَّنة فعلياً في أثر ---`);
    dbEntry.lines.forEach((l) => console.log(`    ${l.accountName} | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)} | ${l.description || "—"}`));

    // الفرضية الأولى (مرجَع تاريخياً هنا فقط للسياق — رُفضت رقمياً 0/11 على بيانات الإنتاج الفعلية):
    // هل "الزائد بعد طرح الصحيح مرة واحدة" = مضاعف تام لقيد PYT/INV بمفرده؟
    const legacyResult = checkExtraLinesHypothesis(dbEntry, correctEntry, pytInvEntries);
    if (legacyResult.unmatchedLines.length === 0) {
      console.log(`\n  ✅ (فرضية الوحدة المفردة) لا توجد أي أسطر زائدة فعلياً بعد فحص القيم — القيد مطابق تماماً.`);
      confirmedCount++;
      continue;
    }

    // الفرضية المُنقَّحة: كل أسطر القيد المخزَّن بالكامل (لا الزائد فقط) = k × [الصحيح + مرشّح واحد]
    const combined = checkCombinedUnitHypothesis(dbEntry, correctEntry, pytInvEntries);
    if (combined.matches.length === 1) {
      const m = combined.matches[0];
      console.log(`\n  ✅ الفرضية المُنقَّحة مؤكَّدة رقمياً: كل الأسطر المخزَّنة (${combined.totalDbLines}) = [القيد الصحيح (${correctEntry.lines.length} سطراً) + القيد "${m.candidateReference}" (${m.candidatePattern})] مكرَّرة ${m.multiplier} مرة/مرات بالضبط.`);
      confirmedCount++;
    } else if (combined.matches.length > 1) {
      console.log(`\n  ⚠️ أكثر من مرشّح واحد يحقق الفرضية المُنقَّحة رقمياً بنفس الدقة — غموض يحتاج مراجعة يدوية (لا يمكن الجزم بأيهما الصحيح تلقائياً):`);
      combined.matches.forEach((m) => console.log(`    "${m.candidateReference}" (${m.candidatePattern}) × ${m.multiplier}`));
      unresolvedCount++;
    } else {
      console.log(`\n  ❌ لا يوجد أي قيد PYT/INV واحد يجعل [الصحيح + ذلك القيد] يفسّر كل الأسطر المخزَّنة (${combined.totalDbLines}) كمضاعف تام. الفرضية المُنقَّحة غير مؤكَّدة لهذا القيد تحديداً — يحتاج مراجعة يدوية منفصلة قبل أي افتراض إضافي.`);
      unresolvedCount++;
    }
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log(`=== ملخص ===`);
  console.log(`${"=".repeat(60)}`);
  console.log(`قيود مؤكَّدة رقمياً (بلا زيادة، أو زيادة مفسَّرة بالكامل كمضاعف تام لقيد PYT/INV واحد): ${confirmedCount} من ${KNOWN_EXTRA_LINE_ENTRY_NUMBERS.length}`);
  console.log(`قيود غير مؤكَّدة (تحتاج مراجعة يدوية قبل أي تصحيح): ${unresolvedCount} من ${KNOWN_EXTRA_LINE_ENTRY_NUMBERS.length}`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
