/**
 * سكريبت تحقيق قرائي فقط (بلا أي تعديل) — يفحص كل القيود المستوردة عبر bulk_import لشركة أرمي،
 * يستخرج رقم القيد الأصلي من نص الـmemo ("قيد يدوي رقم N - أنشئ بواسطة ...")، ويقارن التاريخ
 * المخزَّن فعلياً بالتاريخ الصحيح المرجعي (من ملف مرجعي مثل armi_full_journal_2023_2026.csv) لو
 * توفّر مساره كمعامل. لا يُنشئ ولا يُعدّل ولا يحذف أي شيء إطلاقاً.
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/investigate-armi-bulk-import-dates.ts [مسار-الملف-المرجعي.csv]
 *
 * لو مرَّرت مسار الملف المرجعي (عمود "رقم القيد الأصلي (قيود)" وعمود "التاريخ" بصيغة YYYY-MM-DD)،
 * يُطبع تقرير كامل: عدد القيود المطابقة/المختلفة، تفصيل كل اختلاف، وتوزيعها حسب (يوم ≤ 12 أم لا).
 * بدون الملف المرجعي، يُطبع فقط استخراج (رقم القيد الأصلي ← التاريخ المخزَّن) لكل قيد كجدول خام.
 */
import { readFileSync, existsSync } from "node:fs";
import { prisma } from "../src/lib/prisma";

const ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const MEMO_ENTRY_NUMBER_RE = /قيد يدوي رقم\s*(\d+)/;

function parseReferenceCsv(path: string): Map<number, string> {
  const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  const entryNoIdx = header.findIndex((h) => h.includes("رقم القيد الأصلي"));
  const dateIdx = header.findIndex((h) => h.trim() === "التاريخ");
  if (entryNoIdx === -1 || dateIdx === -1) {
    throw new Error("لم يُعثَر على عمودَي 'رقم القيد الأصلي' أو 'التاريخ' في الملف المرجعي");
  }
  const map = new Map<number, string>();
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const entryNo = Number(cols[entryNoIdx]);
    const date = cols[dateIdx]?.trim();
    if (!entryNo || !date) continue;
    if (!map.has(entryNo)) map.set(entryNo, date); // أول سطر لكل قيد يكفي (نفس التاريخ لكل أسطره)
  }
  return map;
}

async function main() {
  const referencePath = process.argv[2];

  const entries = await prisma.journalEntry.findMany({
    where: { companyId: ARMI_COMPANY_ID, sourceModule: "bulk_import" },
    select: { id: true, entryNumber: true, memo: true, date: true },
    orderBy: { entryNumber: "asc" },
  });

  console.log(`إجمالي القيود المستوردة (bulk_import) لشركة أرمي: ${entries.length}`);

  const rows = entries.map((e) => {
    const match = e.memo ? MEMO_ENTRY_NUMBER_RE.exec(e.memo) : null;
    const originalEntryNumber = match ? Number(match[1]) : null;
    return {
      originalEntryNumber,
      storedEntryId: e.id,
      storedEntryNumber: e.entryNumber,
      storedDate: e.date.toISOString().slice(0, 10),
      memo: e.memo,
    };
  });

  const withoutMatch = rows.filter((r) => r.originalEntryNumber === null);
  if (withoutMatch.length) {
    console.log(`\n⚠️ ${withoutMatch.length} قيد لم يُستخرَج له رقم قيد أصلي من الـmemo (نمط غير متوقع):`);
    withoutMatch.slice(0, 10).forEach((r) => console.log(`  ${r.storedEntryNumber}: "${r.memo}"`));
  }

  if (!referencePath) {
    console.log("\n(لم يُمرَّر مسار ملف مرجعي — طباعة الاستخراج الخام فقط)");
    console.log("originalEntryNumber,storedDate,storedEntryNumber");
    rows
      .filter((r) => r.originalEntryNumber !== null)
      .sort((a, b) => (a.originalEntryNumber! - b.originalEntryNumber!))
      .forEach((r) => console.log(`${r.originalEntryNumber},${r.storedDate},${r.storedEntryNumber}`));
    return;
  }

  if (!existsSync(referencePath)) throw new Error(`الملف المرجعي غير موجود: ${referencePath}`);
  const reference = parseReferenceCsv(referencePath);
  console.log(`\nعدد القيود الفريدة في الملف المرجعي: ${reference.size}`);

  const mismatches: { originalEntryNumber: number; correctDate: string; storedDate: string; day: number }[] = [];
  let matched = 0;
  let missingInDb = 0;

  for (const [originalEntryNumber, correctDate] of reference) {
    const row = rows.find((r) => r.originalEntryNumber === originalEntryNumber);
    if (!row) {
      missingInDb++;
      continue;
    }
    if (row.storedDate === correctDate) {
      matched++;
    } else {
      const day = Number(correctDate.slice(8, 10));
      mismatches.push({ originalEntryNumber, correctDate, storedDate: row.storedDate, day });
    }
  }

  console.log(`\n=== التقرير ===`);
  console.log(`مطابق تماماً: ${matched}`);
  console.log(`مختلف (تاريخ خاطئ مخزَّن): ${mismatches.length}`);
  console.log(`موجود بالمرجع لكن غير موجود في القيود المستوردة: ${missingInDb}`);

  const ambiguousDay = mismatches.filter((m) => m.day <= 12).length;
  const unambiguousDay = mismatches.filter((m) => m.day > 12).length;
  console.log(`\nمن أصل الاختلافات: يوم ≤ 12 (قابل للالتباس DD/MM): ${ambiguousDay} | يوم > 12 (غير قابل للالتباس): ${unambiguousDay}`);

  if (mismatches.length) {
    console.log(`\nأول 30 اختلافاً (رقم القيد الأصلي | الصحيح | المخزَّن فعلياً):`);
    mismatches.slice(0, 30).forEach((m) => console.log(`  #${m.originalEntryNumber}  ${m.correctDate}  ->  ${m.storedDate}`));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
