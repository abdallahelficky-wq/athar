/**
 * اختبار محلي بحت (بلا CSV، بلا DB) لمنطق checkExtraLinesHypothesis المُصدَّر من
 * verify-armi-extra-lines-hypothesis.ts — يتحقق من صحة اكتشاف "المضاعف k" قبل تشغيل السكريبت
 * الحقيقي على بيانات إنتاج فعلية.
 *
 * التشغيل: npx tsx scripts/test-armi-extra-lines-hypothesis.ts
 */
import { checkExtraLinesHypothesis, type DbEntryForCheck } from "./verify-armi-extra-lines-hypothesis";
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

console.log(`\n${"=".repeat(40)}`);
if (failures === 0) {
  console.log("✅ كل الاختبارات نجحت — منطق اكتشاف المضاعف k يعمل بدقة، بما فيه تمييز PYT7 عن PYT8 والتاريخ الصحيح.");
  process.exitCode = 0;
} else {
  console.log(`❌ فشل ${failures} اختباراً — لا تُشغِّل سكريبت التحقق الحقيقي على الإنتاج قبل إصلاح هذا.`);
  process.exitCode = 1;
}
