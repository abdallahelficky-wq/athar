/**
 * اختبار محلي بحت لمنطق المطابقة في investigate-armi-full-reconciliation.ts، ببيانات تركيبية
 * تُنشَأ في الذاكرة فقط (لا ملفات CSV، لا اتصال DB إطلاقاً) — يستورد نفس الدوال المُصدَّرة
 * الحقيقية (matchEntries وgroupExcelEntries) بدل إعادة كتابة المنطق، حتى يكون الاختبار فعلاً
 * لنفس الكود الذي سيُشغَّل على الإنتاج، لا نسخة موازية منه.
 *
 * يغطي كل تصنيفات التقرير المطلوبة: مطابقة تامة (رقمية وPYT/INV)، غياب كامل (رقمي وPYT)،
 * أسطر أكثر في أثر، أسطر أقل في أثر، رقم أصلي مكرَّر (يحتاج مراجعة يدوية)، مرشَّحون متعددون
 * لمطابقة PYT/INV (يحتاج مراجعة يدوية)، وقيد زائد في أثر بلا أي مصدر.
 *
 * التشغيل: npx tsx scripts/test-armi-reconciliation-logic.ts
 */
import {
  type DbEntryLike,
  type ExcelLine,
  groupExcelEntries,
  matchEntries,
} from "./investigate-armi-full-reconciliation";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function excelLine(ref: string, date: string, account: string, debit: number, credit: number, type = "قيد يدوي"): ExcelLine {
  return { classification: "test", date, account, type, description: `desc ${ref}`, reference: ref, debit, credit };
}

function dbEntry(id: string, entryNumber: string, memo: string | null, date: string, lines: { account: string; debit: number; credit: number }[]): DbEntryLike {
  return {
    id,
    entryNumber,
    memo,
    date: new Date(date),
    lines: lines.map((l) => ({ debit: l.debit, credit: l.credit, account: { name: l.account } })),
  };
}

console.log("=== بناء بيانات تركيبية تحاكي كل حالات التقرير ===\n");

const excelLines: ExcelLine[] = [
  // 1) رقمي مطابق تماماً
  excelLine("1", "2024-01-01", "البنك", 1000, 0),
  excelLine("1", "2024-01-01", "المبيعات", 0, 1000),

  // 2) رقمي غائب تماماً من أثر
  excelLine("2", "2024-01-02", "البنك", 500, 0),
  excelLine("2", "2024-01-02", "المصاريف", 0, 500),

  // 3) رقمي بأسطر أكثر في أثر (لدينا 2 في قيود، أثر سيحتوي 3)
  excelLine("3", "2024-01-03", "البنك", 300, 0),
  excelLine("3", "2024-01-03", "المصاريف", 0, 300),

  // 4) رقمي بأسطر أقل في أثر (لدينا 3 في قيود، أثر سيحتوي 2)
  excelLine("4", "2024-01-04", "البنك", 700, 0),
  excelLine("4", "2024-01-04", "مصاريف أ", 0, 400),
  excelLine("4", "2024-01-04", "مصاريف ب", 0, 300),

  // 5+6) رقمان (5 و6) يشيران لنفس الرقم الأصلي في أثر (تكرار قيد كامل -> يحتاج مراجعة يدوية)
  excelLine("5", "2024-01-05", "البنك", 200, 0),
  excelLine("5", "2024-01-05", "المصاريف", 0, 200),

  // PYT1: مطابقة PYT بالتاريخ+المبلغ (بلا رقم في الـmemo)
  excelLine("PYT1", "2024-02-01", "البنك", 150, 0, "سند قبض"),
  excelLine("PYT1", "2024-02-01", "العميل", 0, 150, "سند قبض"),

  // PYT2: غائب تماماً (لا يوجد أي قيد أثر بنفس التاريخ/المبلغ)
  excelLine("PYT2", "2024-02-02", "البنك", 250, 0, "سند قبض"),
  excelLine("PYT2", "2024-02-02", "العميل", 0, 250, "سند قبض"),

  // PYT3: مرشّحان متعددان بنفس التاريخ/المبلغ في أثر (غموض -> يحتاج مراجعة يدوية)
  excelLine("PYT3", "2024-02-03", "البنك", 400, 0, "سند قبض"),
  excelLine("PYT3", "2024-02-03", "العميل", 0, 400, "سند قبض"),

  // INV1: مطابقة INV بالتاريخ+المبلغ
  excelLine("INV1", "2024-03-01", "العميل", 900, 0, "فاتورة مبيعات"),
  excelLine("INV1", "2024-03-01", "المبيعات", 0, 900, "فاتورة مبيعات"),

  // نمط غير معروف (يجب أن يُصنَّف OTHER ويُعامَل مثل الرقمي من ناحية عدم وجود مطابقة مبنية على originalNumber)
];

const excelEntries = groupExcelEntries(excelLines);

const dbEntries: DbEntryLike[] = [
  // مطابقة تامة للرقم 1
  dbEntry("db1", "J00001", "قيد يدوي رقم 1", "2024-01-01", [
    { account: "البنك", debit: 1000, credit: 0 },
    { account: "المبيعات", debit: 0, credit: 1000 },
  ]),

  // الرقم 2 غائب تماماً من أثر — لا نضيف شيئاً له

  // الرقم 3: أسطر أكثر في أثر (3 أسطر مقابل 2 في قيود)
  dbEntry("db3", "J00003", "قيد يدوي رقم 3", "2024-01-03", [
    { account: "البنك", debit: 300, credit: 0 },
    { account: "المصاريف", debit: 0, credit: 150 },
    { account: "مصاريف زائدة", debit: 0, credit: 150 },
  ]),

  // الرقم 4: أسطر أقل في أثر (2 أسطر مقابل 3 في قيود)
  dbEntry("db4", "J00004", "قيد يدوي رقم 4", "2024-01-04", [
    { account: "البنك", debit: 700, credit: 0 },
    { account: "مصاريف أ", debit: 0, credit: 700 },
  ]),

  // تكرار: قيدان في أثر كلاهما يحمل نفس الرقم الأصلي 5
  dbEntry("db5a", "J00005", "قيد يدوي رقم 5", "2024-01-05", [
    { account: "البنك", debit: 200, credit: 0 },
    { account: "المصاريف", debit: 0, credit: 200 },
  ]),
  dbEntry("db5b", "J00099", "قيد يدوي رقم 5", "2024-01-05", [
    { account: "البنك", debit: 200, credit: 0 },
    { account: "المصاريف", debit: 0, credit: 200 },
  ]),

  // PYT1: قيد بلا رقم مستخرَج، يُطابَق بالتاريخ+المبلغ فقط
  dbEntry("dbPyt1", "J00006", "Receipt voucher PYT1", "2024-02-01", [
    { account: "البنك (اسم مختلف في أثر)", debit: 150, credit: 0 },
    { account: "العميل", debit: 0, credit: 150 },
  ]),

  // PYT2: لا يوجد أي قيد مطابق — يبقى غائباً تماماً

  // PYT3: مرشّحان اثنان بنفس التاريخ/المبلغ (غموض متعمَّد)
  dbEntry("dbPyt3a", "J00007", "Receipt voucher unclear A", "2024-02-03", [
    { account: "البنك", debit: 400, credit: 0 },
    { account: "العميل", debit: 0, credit: 400 },
  ]),
  dbEntry("dbPyt3b", "J00008", "Receipt voucher unclear B", "2024-02-03", [
    { account: "البنك", debit: 400, credit: 0 },
    { account: "العميل", debit: 0, credit: 400 },
  ]),

  // INV1: مطابقة تامة بالتاريخ+المبلغ
  dbEntry("dbInv1", "J00009", "Sales invoice INV1", "2024-03-01", [
    { account: "العميل", debit: 900, credit: 0 },
    { account: "المبيعات", debit: 0, credit: 900 },
  ]),

  // قيد زائد في أثر بلا أي مصدر في قيود إطلاقاً
  dbEntry("dbOrphan", "J00010", "قيد يدوي رقم 9999", "2024-04-01", [
    { account: "حساب غريب", debit: 50, credit: 0 },
    { account: "حساب آخر", debit: 0, credit: 50 },
  ]),
];

const result = matchEntries(excelEntries, dbEntries);

console.log("=== نتائج المطابقة ===\n");
console.log("مطابق تماماً:", result.exactMatches.sort());
console.log("غائب تماماً:", result.missingEntirely.map((e) => e.reference).sort());
console.log("أسطر أكثر في أثر:", result.moreLinesInAthar.map((x) => x.excel.reference));
console.log("أسطر أقل في أثر:", result.fewerLinesInAthar.map((x) => x.excel.reference));
console.log("زائد في أثر بلا مصدر:", result.extraInAthar.map((x) => x.entry.entryNumber));
console.log("يحتاج مراجعة يدوية:", result.needsManualReview);
console.log("أرقام مكرَّرة:", result.duplicateNumbers.map(([n]) => n));

console.log("\n=== التحقق (assertions) ===\n");

check('المرجع "1" مطابق تماماً', result.exactMatches.includes("1"));
check('المرجع "PYT1" مطابق تماماً (بالتاريخ+المبلغ لا بالـmemo)', result.exactMatches.includes("PYT1"));
check('المرجع "INV1" مطابق تماماً', result.exactMatches.includes("INV1"));
check("عدد المطابقات التامة = 3 بالضبط", result.exactMatches.length === 3, `الفعلي=${result.exactMatches.length}`);

check(
  'المرجع "2" (رقمي) ضمن الغائب تماماً',
  result.missingEntirely.some((e) => e.reference === "2"),
);
check(
  'المرجع "PYT2" ضمن الغائب تماماً (لا يوجد مرشّح بنفس التاريخ/المبلغ)',
  result.missingEntirely.some((e) => e.reference === "PYT2"),
);
check("عدد الغائبين تماماً = 2 بالضبط (2 وPYT2 فقط)", result.missingEntirely.length === 2, `الفعلي=${result.missingEntirely.length}`);

check(
  'المرجع "3" ضمن أسطر أكثر في أثر (3 في أثر مقابل 2 في قيود)',
  result.moreLinesInAthar.some((x) => x.excel.reference === "3" && x.db.entryNumber === "J00003"),
);
check("عدد حالات أسطر أكثر = 1 بالضبط", result.moreLinesInAthar.length === 1, `الفعلي=${result.moreLinesInAthar.length}`);

check(
  'المرجع "4" ضمن أسطر أقل في أثر (2 في أثر مقابل 3 في قيود)',
  result.fewerLinesInAthar.some((x) => x.excel.reference === "4" && x.db.entryNumber === "J00004"),
);
check("عدد حالات أسطر أقل = 1 بالضبط", result.fewerLinesInAthar.length === 1, `الفعلي=${result.fewerLinesInAthar.length}`);

check(
  "الرقم الأصلي 5 مكرَّر (قيدان db5a وdb5b) وظهر في duplicateNumbers",
  result.duplicateNumbers.some(([num]) => num === 5),
);
check(
  'قيدا الرقم 5 (J00005 وJ00099) ضمن "يحتاج مراجعة يدوية" وليسا ضمن أي فئة أخرى',
  result.needsManualReview.some((r) => r.reference === "5") &&
    !result.exactMatches.includes("5") &&
    !result.missingEntirely.some((e) => e.reference === "5"),
);

check(
  'المرجع "PYT3" ضمن "يحتاج مراجعة يدوية" (مرشّحان متعددان بنفس التاريخ/المبلغ)',
  result.needsManualReview.some((r) => r.reference === "PYT3"),
);
check(
  'المرجع "PYT3" ليس ضمن الغائب تماماً ولا المطابق تماماً (تم حجزه كغموض فقط)',
  !result.missingEntirely.some((e) => e.reference === "PYT3") && !result.exactMatches.includes("PYT3"),
);

check(
  'قيد "J00010" (بلا أي مصدر في قيود) ضمن extraInAthar',
  result.extraInAthar.some((x) => x.entry.entryNumber === "J00010"),
);
check(
  'قيدا PYT3 المتنازع عليهما (J00007 وJ00008) لم يُحتَسَبا كـ"زائد بلا مصدر" رغم عدم تأكيد مطابقتهما',
  !result.extraInAthar.some((x) => ["J00007", "J00008"].includes(x.entry.entryNumber)),
);
check(
  "عدد الزائد في أثر بلا مصدر = 1 بالضبط (J00010 فقط)",
  result.extraInAthar.length === 1,
  `الفعلي=${result.extraInAthar.map((x) => x.entry.entryNumber).join(",")}`,
);

console.log(`\n${"=".repeat(40)}`);
if (failures === 0) {
  console.log("✅ كل الاختبارات نجحت — منطق المطابقة يصنّف كل حالة تركيبية في الفئة الصحيحة تماماً.");
  process.exitCode = 0;
} else {
  console.log(`❌ فشل ${failures} اختباراً — لا تُشغِّل السكريبت الحقيقي على الإنتاج قبل إصلاح هذا.`);
  process.exitCode = 1;
}
