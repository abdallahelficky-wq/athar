/**
 * اختبار محلي بحت (بلا CSV حقيقي، بلا DB) لمنطق prepareEntries المُصدَّر من
 * create-armi-missing-entries.ts — يتحقق من بناء الـmemo، فحص التوازن، ورفض القيود متعددة التاريخ،
 * قبل تشغيل السكريبت الحقيقي (وقبل اختبار التكامل الكامل ضد قاعدة بيانات محلية).
 *
 * التشغيل: npx tsx scripts/test-create-armi-missing-entries-logic.ts
 */
import { prepareEntries } from "./create-armi-missing-entries";
import { groupExcelEntries, type ExcelLine } from "./investigate-armi-full-reconciliation";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function excelLine(ref: string, date: string, account: string, debit: number, credit: number, type: string, description = `desc ${ref}`): ExcelLine {
  return { classification: "test", date, account, type, description, reference: ref, debit, credit };
}

console.log("=== بناء بيانات تركيبية: PYT صالح، INV صالح، PYT غير متوازن، PYT بتاريخين، NUMERIC (يجب تجاهله تماماً) ===\n");

const lines: ExcelLine[] = [
  // PYT1: صالح تماماً
  excelLine("PYT1", "2024-01-01", "البنك", 100, 0, "سند قبض"),
  excelLine("PYT1", "2024-01-01", "العميل", 0, 100, "سند قبض"),

  // INV1: صالح تماماً
  excelLine("INV1", "2024-02-01", "العميل", 200, 0, "فاتورة مبيعات"),
  excelLine("INV1", "2024-02-01", "المبيعات", 0, 200, "فاتورة مبيعات"),

  // PYT2: غير متوازن عمداً (50 مقابل 40)
  excelLine("PYT2", "2024-03-01", "البنك", 50, 0, "سند قبض"),
  excelLine("PYT2", "2024-03-01", "العميل", 0, 40, "سند قبض"),

  // PYT3: أسطره موزَّعة على تاريخين مختلفين (حالة شاذة يجب رفضها)
  excelLine("PYT3", "2024-04-01", "البنك", 70, 0, "سند قبض"),
  excelLine("PYT3", "2024-04-02", "العميل", 0, 70, "سند قبض"),

  // قيد رقمي عادي — يجب ألا يظهر في prepared أو problems إطلاقاً، هذا السكريبت لا يلمسه
  excelLine("999", "2024-05-01", "البنك", 10, 0, "قيد يدوي"),
  excelLine("999", "2024-05-01", "المصاريف", 0, 10, "قيد يدوي"),
];

const excelEntries = groupExcelEntries(lines);
const { prepared, problems } = prepareEntries(excelEntries);

console.log("prepared:", prepared.map((p) => p.reference));
console.log("problems:", problems);

check("عدد القيود الصالحة = 2 (PYT1, INV1 فقط)", prepared.length === 2, `الفعلي=${prepared.length}`);
check("عدد المشاكل = 2 (PYT2 غير متوازن، PYT3 متعدد التاريخ)", problems.length === 2, `الفعلي=${problems.length}`);
check("القيد الرقمي 999 غير موجود في prepared", !prepared.some((p) => p.reference === "999"));
check("القيد الرقمي 999 غير موجود في problems أيضاً (يُتجاهَل من الأساس، لا يُعامَل كمشكلة)", !problems.some((p) => p.includes("999")));

const pyt1 = prepared.find((p) => p.reference === "PYT1")!;
check('memo القيد PYT1 = "سند قبض رقم PYT1 - مستورد من قيود"', pyt1.memo === "سند قبض رقم PYT1 - مستورد من قيود", `الفعلي="${pyt1.memo}"`);
check("تاريخ PYT1 صحيح", pyt1.date === "2024-01-01");
check("عدد أسطر PYT1 = 2", pyt1.lines.length === 2);

const inv1 = prepared.find((p) => p.reference === "INV1")!;
check('memo القيد INV1 = "فاتورة مبيعات رقم INV1 - مستورد من قيود"', inv1.memo === "فاتورة مبيعات رقم INV1 - مستورد من قيود", `الفعلي="${inv1.memo}"`);

check("رسالة مشكلة PYT2 تذكر عدم التوازن", problems.some((p) => p.includes("PYT2") && p.includes("غير متوازن")));
check("رسالة مشكلة PYT3 تذكر تعدد التاريخ", problems.some((p) => p.includes("PYT3") && p.includes("أكثر من تاريخ")));

console.log(`\n${"=".repeat(40)}`);
if (failures === 0) {
  console.log("✅ كل الاختبارات نجحت — prepareEntries يبني الـmemo الصحيح، يرفض غير المتوازن ومتعدد التاريخ، ويتجاهل القيود الرقمية تماماً.");
  process.exitCode = 0;
} else {
  console.log(`❌ فشل ${failures} اختباراً — لا تُشغِّل السكريبت الحقيقي حتى على شركة تجريبية قبل إصلاح هذا.`);
  process.exitCode = 1;
}
