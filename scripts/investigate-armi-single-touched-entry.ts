/**
 * سكريبت تحقيق قرائي بحت — يطبع كل تفاصيل القيد/القيود التي أظهرها
 * investigate-armi-rollback-verification.ts (updatedAt <> createdAt)، ويقارن كل واحد منها
 * بالملف المرجعي تلقائياً ليحدّد: هل تاريخه الحالي مطابق للمرجع الصحيح (أثر تحديث فعلي)، أم لا يزال
 * بتاريخه الأصلي كما استُورد (لمسة غير متعلقة بتاريخه/وصفه إطلاقاً، مثل تعديل يدوي عادي من الواجهة
 * على حقل آخر). لا يكتب ولا يعدّل شيئاً إطلاقاً.
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/investigate-armi-single-touched-entry.ts <مسار-الملف-المرجعي.csv>
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const MEMO_ENTRY_NUMBER_RE = /قيد يدوي رقم\s*(\d+)/;

interface ReferenceLine {
  lineSeq: number;
  date: string;
  accountOldName: string;
  debit: number;
  credit: number;
  description: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { fields.push(cur); cur = ""; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  return cleaned ? Number(cleaned) : 0;
}

function loadReferenceFor(path: string, entryNumber: number): ReferenceLine[] {
  const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const result: ReferenceLine[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    if (Number(cols[0]) !== entryNumber) continue;
    result.push({
      lineSeq: Number(cols[1]),
      date: cols[2]?.trim(),
      accountOldName: cols[3]?.trim(),
      debit: parseAmount(cols[4] || "0"),
      credit: parseAmount(cols[5] || "0"),
      description: (cols[6] || "").trim(),
    });
  }
  return result.sort((a, b) => a.lineSeq - b.lineSeq);
}

async function main() {
  const referencePath = process.argv[2];
  if (!referencePath) throw new Error("مرّر مسار الملف المرجعي كمعامل أول");
  if (!existsSync(referencePath)) throw new Error(`الملف غير موجود: ${referencePath}`);

  const touchedEntries = await prisma.journalEntry.findMany({
    where: { companyId: ARMI_COMPANY_ID, sourceModule: "bulk_import" },
    select: { id: true, entryNumber: true, memo: true, date: true, createdAt: true, updatedAt: true },
  });
  const mismatches = touchedEntries.filter((e) => e.updatedAt.getTime() !== e.createdAt.getTime());

  console.log(`عدد القيود التي updatedAt فيها يختلف عن createdAt: ${mismatches.length}\n`);

  for (const entry of mismatches) {
    const match = entry.memo ? MEMO_ENTRY_NUMBER_RE.exec(entry.memo) : null;
    const originalEntryNumber = match ? Number(match[1]) : null;

    console.log("=".repeat(70));
    console.log(`القيد: entryNumber=${entry.entryNumber}  id=${entry.id}`);
    console.log(`رقم القيد الأصلي (من الـmemo): ${originalEntryNumber ?? "تعذّر الاستخراج"}`);
    console.log(`memo: "${entry.memo}"`);
    console.log(`createdAt: ${entry.createdAt.toISOString()}`);
    console.log(`updatedAt: ${entry.updatedAt.toISOString()}`);
    console.log(`الفرق الزمني: ${((entry.updatedAt.getTime() - entry.createdAt.getTime()) / 1000).toFixed(3)} ثانية`);
    console.log(`التاريخ الحالي المخزَّن (date): ${entry.date.toISOString().slice(0, 10)}`);

    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: entry.id },
      select: { id: true, debit: true, credit: true, description: true },
      orderBy: { id: "asc" },
    });
    console.log(`أسطر القيد الحالية (${lines.length} سطراً):`);
    lines.forEach((l) => console.log(`  ${Number(l.debit).toFixed(2)} | ${Number(l.credit).toFixed(2)} | ${l.description ?? "—"}`));

    if (originalEntryNumber === null) {
      console.log("\n⚠️ تعذّر استخراج رقم القيد الأصلي — لا يمكن مقارنته بالملف المرجعي تلقائياً.");
      continue;
    }
    const refLines = loadReferenceFor(referencePath, originalEntryNumber);
    if (!refLines.length) {
      console.log(`\n⚠️ لا يوجد للقيد #${originalEntryNumber} أي بيانات في الملف المرجعي.`);
      continue;
    }
    console.log(`\nالمرجع الصحيح للقيد #${originalEntryNumber} (${refLines.length} سطراً، التاريخ الصحيح ${refLines[0].date}):`);
    refLines.forEach((l) => console.log(`  ${l.debit.toFixed(2)} | ${l.credit.toFixed(2)} | ${l.accountOldName} | ${l.description}`));

    const dateMatchesReference = entry.date.toISOString().slice(0, 10) === refLines[0].date;
    console.log(`\n>>> التاريخ الحالي المخزَّن ${dateMatchesReference ? "يطابق" : "لا يطابق"} التاريخ الصحيح في المرجع.`);
    const anyDescriptionMatchesReference = lines.some((l) => refLines.some((r) => r.description && l.description === r.description));
    console.log(`>>> ${anyDescriptionMatchesReference ? "يوجد" : "لا يوجد"} سطر واحد على الأقل وصفه الحالي يطابق نص المرجع حرفياً.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
