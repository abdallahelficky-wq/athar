/**
 * سكريبت قرائي فقط بالكامل — لا يُعدِّل ولا يحذف ولا يُنشئ أي شيء في قاعدة البيانات. لا يعتمد على
 * أي ملف مرجعي (CSV) خارجي؛ كل الفحوصات هنا داخلية بحتة على ما هو مخزَّن بالفعل في قاعدة البيانات.
 *
 * غرضه: التحقق مما إذا كانت عملية استيراد القيود التاريخية لشركة أرمي (2023-2026، من
 * reference/armi_full_journal_2023_2026.csv، 1,811 قيداً بواقع 4,764 سطراً عبر 83 حساباً) قد
 * نُفِّذت فعلاً، ولمرة واحدة فقط، وبتوازن مدين/دائن سليم — دون أي افتراض مسبق بنجاحها أو فشلها أو
 * تكرارها.
 *
 * الفحوصات الستة:
 *   1) إجمالي عدد القيود لهذه الشركة، مُقسَّماً بالسنة (2023-2026 صراحةً، وأي سنة أخرى ظهرت أيضاً).
 *   2) إجمالي عدد أسطر القيود لهذه الشركة.
 *   3) مجموع المدين ومجموع الدائن لكل الأسطر، وهل يتطابقان.
 *   4) كشف التكرار: أي مجموعة قيود تشترك في نفس (التاريخ + البيان memo كمرجع تقريبي + إجمالي
 *      المبلغ) — هذا هو الفحص الحاسم لاكتشاف استيراد مزدوج. البيان (memo) يُستخدَم كبديل عن حقل
 *      "مرجع" مخصَّص لأن القيود المستورَدة من CSV تاريخياً تحمل رقم/نص المرجع الأصلي داخل memo
 *      نفسه (نفس الافتراض المُستخدَم فعلياً في سكريبتات أرمي الأخرى في هذا المستودع).
 *   5) أقدم وأحدث تاريخ قيد لهذه الشركة.
 *   6) هل الحسابات الثمانية التالية موجودة في شجرة حسابات أرمي: حسابا جاري الشريكين (اثنان)،
 *      "مشروعات تحت التنفيذ"، مجموعة حسابات الخردة/قطع الغيار، "شركة يسم للتجارة"، "مصاريف أخرى" —
 *      بالبحث عن أي حساب يحتوي اسمه على كل كلمة مفتاحية معاً (لا مطابقة حرفية تامة، حتى لا يفوت
 *      حساباً موجوداً باسم مختلف قليلاً)، مع طباعة كل تطابق فعلي (كوده واسمه)، لا افتراض عددٍ ثابت.
 *
 * الاستخدام (PowerShell):
 *   $env:DATABASE_URL = "..."
 *   npx tsx scripts/check-armi-journal-import-integrity.ts [companyId]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";

const ACCOUNT_KEYWORD_CHECKS: { label: string; keywords: string[] }[] = [
  { label: "جاري الشريك (١)", keywords: ["شريك", "جاري"] },
  { label: "جاري الشريك (٢) — نفس الكلمات المفتاحية، يُميَّز يدوياً من النتائج إن وُجد أكثر من حساب", keywords: ["شريك", "جاري"] },
  { label: "مشروعات تحت التنفيذ", keywords: ["مشروعات", "تحت التنفيذ"] },
  { label: "مجموعة حسابات الخردة", keywords: ["خردة"] },
  { label: "مجموعة حسابات قطع الغيار", keywords: ["قطع غيار"] },
  { label: "شركة يسم للتجارة", keywords: ["يسم"] },
  { label: "مصاريف أخرى", keywords: ["مصاريف أخرى"] },
];

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function run(companyId: string) {
  console.log(`=== فحص سلامة استيراد قيود أرمي التاريخية — companyId=${companyId} (قرائي فقط، بلا أي تعديل) ===\n`);

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);
  console.log(`الشركة: ${company.name} (${company.id})\n`);

  // ---------- 1) عدد القيود مُقسَّماً بالسنة ----------
  const entries = await prisma.journalEntry.findMany({
    where: { companyId },
    select: { id: true, entryNumber: true, date: true, memo: true, sourceModule: true, status: true },
  });
  const byYear = new Map<number, number>();
  for (const e of entries) byYear.set(e.date.getUTCFullYear(), (byYear.get(e.date.getUTCFullYear()) ?? 0) + 1);
  console.log("=== 1) عدد القيود بالسنة ===");
  console.log(`إجمالي كل القيود لهذه الشركة (كل السنوات، كل المصادر): ${entries.length}`);
  for (const year of [2023, 2024, 2025, 2026]) console.log(`  ${year}: ${byYear.get(year) ?? 0}`);
  const otherYears = [...byYear.keys()].filter((y) => ![2023, 2024, 2025, 2026].includes(y));
  if (otherYears.length) {
    console.log("  سنوات أخرى ظهرت (غير متوقعة):");
    otherYears.sort().forEach((y) => console.log(`    ${y}: ${byYear.get(y)}`));
  }
  const byModule = new Map<string, number>();
  for (const e of entries) byModule.set(e.sourceModule, (byModule.get(e.sourceModule) ?? 0) + 1);
  console.log("عدد القيود بحسب sourceModule:");
  [...byModule.entries()].forEach(([m, c]) => console.log(`  ${m}: ${c}`));

  // ---------- 2) عدد الأسطر ----------
  const lineCount = await prisma.journalEntryLine.count({ where: { journalEntry: { companyId } } });
  console.log("\n=== 2) عدد أسطر القيود ===");
  console.log(`إجمالي عدد الأسطر لهذه الشركة: ${lineCount}`);

  // ---------- 3) مجموع المدين/الدائن والتوازن ----------
  const sums = await prisma.journalEntryLine.aggregate({
    where: { journalEntry: { companyId } },
    _sum: { debit: true, credit: true },
  });
  const totalDebit = sums._sum.debit ?? 0;
  const totalCredit = sums._sum.credit ?? 0;
  console.log("\n=== 3) توازن المدين/الدائن ===");
  console.log(`إجمالي المدين: ${totalDebit}`);
  console.log(`إجمالي الدائن: ${totalCredit}`);
  console.log(`الفرق (مدين - دائن): ${Number(totalDebit) - Number(totalCredit)}`);
  console.log(`متوازن تماماً: ${Number(totalDebit) === Number(totalCredit) ? "نعم" : "لا"}`);

  // ---------- 4) كشف التكرار (نفس التاريخ + memo + إجمالي المبلغ) ----------
  const entriesWithTotals = await prisma.journalEntry.findMany({
    where: { companyId },
    select: { id: true, entryNumber: true, date: true, memo: true, lines: { select: { debit: true } } },
  });
  const groups = new Map<string, { entryNumber: string; date: string; memo: string | null; total: number }[]>();
  for (const e of entriesWithTotals) {
    const total = e.lines.reduce((s, l) => s + Number(l.debit), 0);
    const key = `${fmtDate(e.date)}|${e.memo ?? ""}|${total.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ entryNumber: e.entryNumber, date: fmtDate(e.date), memo: e.memo, total });
  }
  const duplicateGroups = [...groups.entries()].filter(([, list]) => list.length > 1);
  console.log("\n=== 4) كشف التكرار (نفس التاريخ + البيان + إجمالي المبلغ) ===");
  console.log(`عدد المجموعات المشتبه بتكرارها: ${duplicateGroups.length}`);
  for (const [key, list] of duplicateGroups) {
    console.log(`  [${list.length} قيود] ${key}`);
    list.forEach((e) => console.log(`      entryNumber=${e.entryNumber}`));
  }

  // ---------- 5) أقدم وأحدث تاريخ ----------
  const dateRange = await prisma.journalEntry.aggregate({ where: { companyId }, _min: { date: true }, _max: { date: true } });
  console.log("\n=== 5) نطاق التواريخ ===");
  console.log(`أقدم تاريخ قيد: ${dateRange._min.date ? fmtDate(dateRange._min.date) : "لا يوجد"}`);
  console.log(`أحدث تاريخ قيد: ${dateRange._max.date ? fmtDate(dateRange._max.date) : "لا يوجد"}`);

  // ---------- 6) وجود الحسابات الثمانية ----------
  const accounts = await prisma.account.findMany({ where: { companyId }, select: { code: true, name: true } });
  console.log("\n=== 6) وجود الحسابات المطلوبة (بحث عن كل الكلمات المفتاحية معاً في الاسم) ===");
  for (const check of ACCOUNT_KEYWORD_CHECKS) {
    const matches = accounts.filter((a) => check.keywords.every((k) => a.name.includes(k)));
    if (matches.length === 0) {
      console.log(`  ${check.label}: غير موجود`);
    } else {
      console.log(`  ${check.label}: موجود (${matches.length} تطابق)`);
      matches.forEach((a) => console.log(`      code=${a.code} name="${a.name}"`));
    }
  }

  console.log("\n=== انتهى الفحص — قرائي بالكامل، لم يُعدَّل أي شيء ===");
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
