/**
 * اختبار محلي بحت (بلا CSV، بلا DB) لمنطق checkExtraLinesHypothesis المُصدَّر من
 * verify-armi-extra-lines-hypothesis.ts — يتحقق من صحة اكتشاف "المضاعف k" قبل تشغيل السكريبت
 * الحقيقي على بيانات إنتاج فعلية.
 *
 * التشغيل: npx tsx scripts/test-armi-extra-lines-hypothesis.ts
 */
import { checkExtraLinesHypothesis, checkCombinedUnitHypothesis, findNearestByDate, type DbEntryForCheck } from "./verify-armi-extra-lines-hypothesis";
import { groupExcelEntries, type ExcelLine } from "./investigate-armi-full-reconciliation";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function excelLine(ref: string, date: string, account: string, debit: number, credit: number, type = "قيد يدوي"): ExcelLine {
  return { classification: "test", date, account, type, description: `desc ${ref}`, reference: ref, debit, credit };
}

// المرجع الصحيح للقيد 401: سطران متوازنان
const correct401Lines = [excelLine("401", "2024-06-01", "البنك", 500, 0), excelLine("401", "2024-06-01", "المصاريف", 0, 500)];
// PYT7: سطران متوازنان في نفس تاريخ 401 — هذا المرشّح المفترَض أن يفسّر الزيادة
const pyt7Lines = [excelLine("PYT7", "2024-06-01", "البنك", 80, 0, "سند قبض"), excelLine("PYT7", "2024-06-01", "العميل", 0, 80, "سند قبض")];
// PYT8: قيد آخر بلا علاقة، تاريخ مختلف تماماً — يجب ألا يُختار خطأً
const pyt8Lines = [excelLine("PYT8", "2024-09-01", "البنك", 999, 0, "سند قبض"), excelLine("PYT8", "2024-09-01", "العميل", 0, 999, "سند قبض")];

const allExcelEntries = groupExcelEntries([...correct401Lines, ...pyt7Lines, ...pyt8Lines]);
const correct401 = allExcelEntries.get("401")!;
const candidates = [...allExcelEntries.values()].filter((e) => e.pattern === "PYT" || e.pattern === "INV");

console.log("=== سيناريو 1: القيد مطابق تماماً (بلا أي زيادة) ===\n");
const scenario1: DbEntryForCheck = {
  date: "2024-06-01",
  lines: [
    { debit: 500, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 500, accountName: "المصاريف", description: null },
  ],
};
const r1 = checkExtraLinesHypothesis(scenario1, correct401, candidates);
check("لا توجد أسطر زائدة", r1.unmatchedLines.length === 0);
check("النتيجة resolved=true (بلا زيادة)", r1.resolved === true);
check("لا أسطر صحيحة غير مطابَقة", r1.unresolvedCorrectLines.length === 0);

console.log("\n=== سيناريو 2: الزيادة = أسطر PYT7 مكرَّرة مرة واحدة (k=1) ===\n");
const scenario2: DbEntryForCheck = {
  date: "2024-06-01",
  lines: [
    { debit: 500, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 500, accountName: "المصاريف", description: null },
    { debit: 80, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 80, accountName: "العميل", description: null },
  ],
};
const r2 = checkExtraLinesHypothesis(scenario2, correct401, candidates);
check("عدد الأسطر الزائدة المكتشفة = 2", r2.unmatchedLines.length === 2, `الفعلي=${r2.unmatchedLines.length}`);
check("الفرضية محلولة (resolved=true)", r2.resolved === true);
check('المرجع المطابَق هو "PYT7" لا "PYT8"', r2.matchedReference === "PYT7", `الفعلي=${r2.matchedReference}`);
check("المضاعف k=1", r2.multiplier === 1, `الفعلي=${r2.multiplier}`);

console.log("\n=== سيناريو 3: الزيادة = أسطر PYT7 مكرَّرة مرتين بالضبط (k=2 — فرضية المستخدم تحديداً) ===\n");
const scenario3: DbEntryForCheck = {
  date: "2024-06-01",
  lines: [
    { debit: 500, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 500, accountName: "المصاريف", description: null },
    { debit: 80, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 80, accountName: "العميل", description: null },
    { debit: 80, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 80, accountName: "العميل", description: null },
  ],
};
const r3 = checkExtraLinesHypothesis(scenario3, correct401, candidates);
check("عدد الأسطر الزائدة المكتشفة = 4", r3.unmatchedLines.length === 4, `الفعلي=${r3.unmatchedLines.length}`);
check("الفرضية محلولة (resolved=true)", r3.resolved === true);
check('المرجع المطابَق هو "PYT7"', r3.matchedReference === "PYT7", `الفعلي=${r3.matchedReference}`);
check("المضاعف k=2 بالضبط (كما تفترض الرسالة)", r3.multiplier === 2, `الفعلي=${r3.multiplier}`);

console.log("\n=== سيناريو 4: زيادة عشوائية لا تطابق أي مرشّح PYT/INV بأي مضاعف (يجب ألا تُحلّ خطأً) ===\n");
const scenario4: DbEntryForCheck = {
  date: "2024-06-01",
  lines: [
    { debit: 500, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 500, accountName: "المصاريف", description: null },
    { debit: 123.45, credit: 0, accountName: "حساب غريب", description: null },
    { debit: 0, credit: 123.45, accountName: "حساب آخر", description: null },
  ],
};
const r4 = checkExtraLinesHypothesis(scenario4, correct401, candidates);
check("عدد الأسطر الزائدة المكتشفة = 2", r4.unmatchedLines.length === 2);
check("الفرضية غير محلولة (resolved=false) — لا يوجد مرشّح مطابق", r4.resolved === false);
check("لا يوجد matchedReference", r4.matchedReference === undefined);

console.log("\n=== سيناريو 5: القيد ناقص سطراً صحيحاً (لا يحتوي كل الصحيح) — يجب رصده لا تجاهله ===\n");
const scenario5: DbEntryForCheck = {
  date: "2024-06-01",
  lines: [{ debit: 500, credit: 0, accountName: "البنك", description: null }],
};
const r5 = checkExtraLinesHypothesis(scenario5, correct401, candidates);
check("سطر صحيح واحد غير مطابَق (المصاريف/500 دائن)", r5.unresolvedCorrectLines.length === 1, `الفعلي=${r5.unresolvedCorrectLines.length}`);
check("لا أسطر زائدة في هذا السيناريو", r5.unmatchedLines.length === 0);

console.log("\n\n=== اختبار الفرضية المُنقَّحة checkCombinedUnitHypothesis (الوحدة المركّبة = الصحيح + مرشّح واحد) ===\n");

console.log("=== سيناريو 6: كل الأسطر المخزَّنة = [الصحيح + PYT7] مرة واحدة بالضبط (k=1) ===\n");
const scenario6: DbEntryForCheck = {
  date: "2024-06-01",
  lines: [
    { debit: 500, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 500, accountName: "المصاريف", description: null },
    { debit: 80, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 80, accountName: "العميل", description: null },
  ],
};
const c6 = checkCombinedUnitHypothesis(scenario6, correct401, candidates);
check("مرشّح واحد بالضبط", c6.matches.length === 1, `الفعلي=${c6.matches.length}`);
check('المرشّح هو "PYT7"', c6.matches[0]?.candidateReference === "PYT7", `الفعلي=${c6.matches[0]?.candidateReference}`);
check("k=1", c6.matches[0]?.multiplier === 1, `الفعلي=${c6.matches[0]?.multiplier}`);

console.log("\n=== سيناريو 7: كل الأسطر المخزَّنة = [الصحيح + PYT7] مكرَّرة مرتين بالضبط (بما فيها الصحيح نفسه مرتين) ===\n");
const scenario7: DbEntryForCheck = {
  date: "2024-06-01",
  lines: [
    { debit: 500, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 500, accountName: "المصاريف", description: null },
    { debit: 80, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 80, accountName: "العميل", description: null },
    { debit: 500, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 500, accountName: "المصاريف", description: null },
    { debit: 80, credit: 0, accountName: "البنك", description: null },
    { debit: 0, credit: 80, accountName: "العميل", description: null },
  ],
};
const c7 = checkCombinedUnitHypothesis(scenario7, correct401, candidates);
check("مرشّح واحد بالضبط", c7.matches.length === 1, `الفعلي=${c7.matches.length}`);
check('المرشّح هو "PYT7" لا "PYT8"', c7.matches[0]?.candidateReference === "PYT7", `الفعلي=${c7.matches[0]?.candidateReference}`);
check("k=2 بالضبط", c7.matches[0]?.multiplier === 2, `الفعلي=${c7.matches[0]?.multiplier}`);

console.log("\n=== سيناريو 8: نفس بيانات سيناريو 3 (فرضية أولى صحيحة سابقاً: صحيح مرة + PYT7 مرتين) — يجب ألا تُحلّ بالفرضية المُنقَّحة لأن الصحيح لا يتكرر بنفس k ===\n");
const c8 = checkCombinedUnitHypothesis(scenario3, correct401, candidates);
check("لا يوجد أي مرشّح يحقق الفرضية المُنقَّحة هنا (بنية غير متجانسة، ليست k مرة من نفس الوحدة)", c8.matches.length === 0, `الفعلي=${c8.matches.length}`);

console.log("\n=== سيناريو 9: أسطر مخزَّنة لا تطابق [الصحيح + أي مرشّح] بأي k (يجب أن تبقى بلا حل) ===\n");
const c9 = checkCombinedUnitHypothesis(scenario4, correct401, candidates);
check("لا يوجد أي تطابق", c9.matches.length === 0, `الفعلي=${c9.matches.length}`);

console.log("\n\n=== اختبار findNearestByDate (معيار قرب التاريخ لكسر التعادل) ===\n");

console.log("\n=== سيناريو 10: مرشّحان بمبالغ متطابقة، أحدهما بنفس تاريخ القيد الصحيح والآخر بتاريخ مختلف — قرب التاريخ يكسر التعادل ===\n");
const tieCandidates = groupExcelEntries([
  excelLine("PYT10", "2025-11-03", "البنك", 300, 0, "سند قبض"),
  excelLine("PYT10", "2025-11-03", "العميل", 0, 300, "سند قبض"),
  excelLine("PYT11", "2025-11-04", "البنك", 300, 0, "سند قبض"),
  excelLine("PYT11", "2025-11-04", "العميل", 0, 300, "سند قبض"),
]);
const tieCandidateList = [...tieCandidates.values()];
const nearest = findNearestByDate("2025-11-03", tieCandidateList, 5);
check("أقرب مرشّح هو PYT10 (فرق 0 يوم)", nearest[0]?.candidateReference === "PYT10" && nearest[0]?.dayDistance === 0, `الفعلي=${JSON.stringify(nearest[0])}`);
check("PYT11 يظهر ثانياً بفرق يوم واحد", nearest[1]?.candidateReference === "PYT11" && nearest[1]?.dayDistance === 1, `الفعلي=${JSON.stringify(nearest[1])}`);

console.log("\n=== سيناريو 11: مرشّحان بنفس التاريخ بالضبط (حالة 688 الحقيقية) — يجب ألا يُدَّعى كسر تعادل زائف ===\n");
const exactTieCandidates = groupExcelEntries([
  excelLine("PYT12", "2025-12-01", "البنك", 400, 0, "سند قبض"),
  excelLine("PYT12", "2025-12-01", "العميل", 0, 400, "سند قبض"),
  excelLine("INV5", "2025-12-01", "البنك", 400, 0, "فاتورة مبيعات"),
  excelLine("INV5", "2025-12-01", "العميل", 0, 400, "فاتورة مبيعات"),
]);
const exactTieList = [...exactTieCandidates.values()];
const nearestExactTie = findNearestByDate("2025-12-01", exactTieList, 5);
check("كلا المرشّحين بفرق 0 يوم (تعادل حقيقي لا يُكسَر بالتاريخ)", nearestExactTie[0]?.dayDistance === 0 && nearestExactTie[1]?.dayDistance === 0);

console.log(`\n${"=".repeat(40)}`);
if (failures === 0) {
  console.log("✅ كل الاختبارات نجحت — منطق اكتشاف المضاعف k (كلا الفرضيتين) ومعيار قرب التاريخ يعملان بدقة، ولا يدّعيان حل تعادل حقيقي (نفس التاريخ بالضبط) زائفاً.");
  process.exitCode = 0;
} else {
  console.log(`❌ فشل ${failures} اختباراً — لا تُشغِّل سكريبت التحقق الحقيقي على الإنتاج قبل إصلاح هذا.`);
  process.exitCode = 1;
}
