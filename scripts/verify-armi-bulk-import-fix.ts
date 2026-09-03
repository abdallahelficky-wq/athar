/**
 * سكريبت تحقق نهائي شامل قرائي بحت (لا عيّنة) — يقارن كل الـ1,811 قيد المستوردة (bulk_import) لشركة
 * أرمي بالملف المرجعي (qoyod_master_reference.csv)، بنفس منطق مطابقة الأسطر بالضبط المستخدَم في
 * fix-armi-bulk-import-data.ts (بالقيمة "مدين/دائن" لا بالترتيب، مع نفس فكّ تعادل القيم عبر ctid).
 * لا يكتب ولا يعدّل شيئاً إطلاقاً.
 *
 * لكل قيد:
 *   - لو عدد أسطره المخزَّنة لا يطابق عدد أسطر المرجع (الفئة "المستبعدة عمداً" — 11 قيداً متوقَّعة) →
 *     يُتحقَّق أنه لا يزال بعدد أسطر أكبر من المرجع (لم يُحذَف منه شيء) وأن updatedAt=createdAt
 *     (لم تُلمَس أي حقول فيه إطلاقاً)، ويُدرَج في قائمة "مستبعد بانتظار قرار يدوي".
 *   - وإلا (الفئة المصحَّحة): يُتحقَّق أن التاريخ مطابق تماماً للمرجع، وأن **كل سطر** (لا سطر واحد
 *     فقط) وصفه الحالي مطابق تماماً لنص المرجع المقابل له بالقيمة. أي اختلاف مهما كان بسيطاً يُدرَج
 *     في قائمة "اختلاف غير مبرر" بكامل التفاصيل.
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/verify-armi-bulk-import-fix.ts <مسار-الملف-المرجعي.csv>
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const MEMO_ENTRY_NUMBER_RE = /قيد يدوي رقم\s*(\d+)/;

interface ReferenceLine {
  entryNumber: number;
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

function loadReference(path: string): Map<number, ReferenceLine[]> {
  const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const byEntry = new Map<number, ReferenceLine[]>();
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const entryNumber = Number(cols[0]);
    if (!entryNumber) continue;
    const refLine: ReferenceLine = {
      entryNumber, lineSeq: Number(cols[1]), date: cols[2]?.trim(), accountOldName: cols[3]?.trim(),
      debit: parseAmount(cols[4] || "0"), credit: parseAmount(cols[5] || "0"), description: (cols[6] || "").trim(),
    };
    const arr = byEntry.get(entryNumber) || [];
    arr.push(refLine);
    byEntry.set(entryNumber, arr);
  }
  for (const arr of byEntry.values()) arr.sort((a, b) => a.lineSeq - b.lineSeq);
  return byEntry;
}

interface DbLine { id: string; debit: number; credit: number; description: string | null }
interface DbEntry {
  id: string; entryNumber: string | null; originalEntryNumber: number;
  date: string; memo: string | null; createdAt: Date; updatedAt: Date; lines: DbLine[];
}

async function loadDbEntries(): Promise<DbEntry[]> {
  const rows = await prisma.$queryRaw<
    { id: string; entryNumber: string | null; date: Date; memo: string | null; createdAt: Date; updatedAt: Date; lineId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; description: string | null }[]
  >`
    SELECT je.id, je."entryNumber", je.date, je.memo, je."createdAt", je."updatedAt",
           jel.id AS "lineId", jel.debit, jel.credit, jel.description
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel."journalEntryId" = je.id
    WHERE je."companyId" = ${ARMI_COMPANY_ID} AND je."sourceModule" = 'bulk_import'
    ORDER BY je.id, jel.ctid
  `;
  const byEntryId = new Map<string, DbEntry>();
  for (const row of rows) {
    let entry = byEntryId.get(row.id);
    if (!entry) {
      const match = row.memo ? MEMO_ENTRY_NUMBER_RE.exec(row.memo) : null;
      entry = {
        id: row.id, entryNumber: row.entryNumber, originalEntryNumber: match ? Number(match[1]) : -1,
        date: row.date.toISOString().slice(0, 10), memo: row.memo, createdAt: row.createdAt, updatedAt: row.updatedAt, lines: [],
      };
      byEntryId.set(row.id, entry);
    }
    entry.lines.push({ id: row.lineId, debit: Number(row.debit), credit: Number(row.credit), description: row.description });
  }
  return [...byEntryId.values()];
}

type LineMatch = { dbLineId: string; refLine: ReferenceLine; tie: boolean };

function matchLines(dbLines: DbLine[], refLines: ReferenceLine[]): { matches: LineMatch[]; ok: boolean } {
  if (dbLines.length !== refLines.length) return { matches: [], ok: false };
  const key = (d: number, c: number) => `${d.toFixed(2)}|${c.toFixed(2)}`;
  const dbByKey = new Map<string, DbLine[]>();
  dbLines.forEach((l) => { const k = key(l.debit, l.credit); (dbByKey.get(k) || dbByKey.set(k, []).get(k)!).push(l); });
  const refByKey = new Map<string, ReferenceLine[]>();
  refLines.forEach((l) => { const k = key(l.debit, l.credit); (refByKey.get(k) || refByKey.set(k, []).get(k)!).push(l); });
  if (dbByKey.size !== refByKey.size) return { matches: [], ok: false };
  const matches: LineMatch[] = [];
  for (const [k, dbGroup] of dbByKey) {
    const refGroup = refByKey.get(k);
    if (!refGroup || refGroup.length !== dbGroup.length) return { matches: [], ok: false };
    const tie = dbGroup.length > 1;
    for (let i = 0; i < dbGroup.length; i++) matches.push({ dbLineId: dbGroup[i].id, refLine: refGroup[i], tie });
  }
  return { matches, ok: true };
}

async function main() {
  const referencePath = process.argv[2];
  if (!referencePath) throw new Error("مرّر مسار الملف المرجعي كمعامل أول");
  if (!existsSync(referencePath)) throw new Error(`الملف غير موجود: ${referencePath}`);

  const reference = loadReference(referencePath);
  const dbEntries = await loadDbEntries();

  console.log(`قيود المرجع الفريدة: ${reference.size}`);
  console.log(`قيود bulk_import المخزَّنة لشركة أرمي: ${dbEntries.length}\n`);

  let fullyMatched = 0;
  const excluded: { originalEntryNumber: number; dbLineCount: number; refLineCount: number; untouched: boolean }[] = [];
  const mismatches: { originalEntryNumber: number; entryId: string; issues: string[] }[] = [];
  const noReference: number[] = [];
  const unparsedMemo: string[] = [];

  for (const entry of dbEntries) {
    if (entry.originalEntryNumber === -1) {
      unparsedMemo.push(entry.id);
      continue;
    }
    const refLines = reference.get(entry.originalEntryNumber);
    if (!refLines) {
      noReference.push(entry.originalEntryNumber);
      continue;
    }

    const { matches, ok } = matchLines(entry.lines, refLines);
    if (!ok) {
      excluded.push({
        originalEntryNumber: entry.originalEntryNumber,
        dbLineCount: entry.lines.length,
        refLineCount: refLines.length,
        untouched: entry.lines.length > refLines.length && entry.updatedAt.getTime() === entry.createdAt.getTime(),
      });
      continue;
    }

    const issues: string[] = [];
    const correctDate = refLines[0].date;
    if (entry.date !== correctDate) issues.push(`التاريخ: مخزَّن=${entry.date} مرجعي=${correctDate}`);
    for (const m of matches) {
      const dbLine = entry.lines.find((l) => l.id === m.dbLineId)!;
      if ((dbLine.description || "") !== m.refLine.description) {
        issues.push(`سطر (${dbLine.debit.toFixed(2)}|${dbLine.credit.toFixed(2)}): وصف مخزَّن="${dbLine.description ?? "—"}" مرجعي="${m.refLine.description}"${m.tie ? " [تعادل قيم]" : ""}`);
      }
    }
    if (issues.length) mismatches.push({ originalEntryNumber: entry.originalEntryNumber, entryId: entry.id, issues });
    else fullyMatched++;
  }

  console.log("=== التحقق التفصيلي ===");
  if (unparsedMemo.length) console.log(`⚠️ قيود تعذّر استخراج رقمها الأصلي: ${unparsedMemo.length} (${unparsedMemo.join(", ")})`);
  if (noReference.length) console.log(`⚠️ قيود بلا أي بيانات مرجعية: ${noReference.length} (${noReference.join(", ")})`);

  console.log(`\n--- القيود المستبعدة عمداً (عدد أسطر لا يطابق المرجع): ${excluded.length} ---`);
  const untouchedCount = excluded.filter((e) => e.untouched).length;
  excluded.forEach((e) => {
    const flag = e.untouched ? "✅ بلا أي تعديل" : "⚠️ ليست كما تُوقَّع (راجعها)";
    console.log(`  #${e.originalEntryNumber}: مخزَّن=${e.dbLineCount} سطراً، مرجعي=${e.refLineCount} سطراً — ${flag}`);
  });

  console.log(`\n--- قيود بها اختلاف غير مبرر عن المرجع: ${mismatches.length} ---`);
  for (const m of mismatches) {
    console.log(`  القيد #${m.originalEntryNumber} (${m.entryId}):`);
    m.issues.forEach((i) => console.log(`    - ${i}`));
  }

  console.log("\n" + "=".repeat(70));
  console.log(
    `النتيجة النهائية: ${fullyMatched}/${dbEntries.length} قيد مطابق بالكامل للمرجع، ` +
    `${excluded.length} قيد بانتظار قرار يدوي (${untouchedCount} منها مؤكَّد بلا أي تعديل)، ` +
    `${mismatches.length} قيد به اختلاف غير مبرر.`
  );
  console.log("=".repeat(70));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
