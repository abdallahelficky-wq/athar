/**
 * سكريبت تصحيح شامل لقيود استيراد أرمي (bulk_import) — Dry-run افتراضياً، --commit للتنفيذ الفعلي.
 * لا يعتمد على src/lib/prisma.ts (ولا src/config/env.ts بالتبعية) — عميل Prisma مستقل، DATABASE_URL فقط.
 *
 * يصحّح لكل قيد (مطابقة برقم القيد الأصلي المستخرَج من الـmemo، بنفس آلية
 * investigate-armi-bulk-import-dates.ts):
 *   1. تاريخ القيد (JournalEntry.date) ليطابق "التاريخ الصحيح" في الملف المرجعي.
 *   2. وصف كل سطر (JournalEntryLine.description) ليطابق "وصف السطر" في الملف المرجعي — فقط
 *      عندما يتطابق عدد أسطر القيد المخزَّنة مع عدد أسطر المرجع تماماً، وتُطابَق الأسطر بمقارنة
 *      (مدين، دائن) بلا اعتماد على أي ترتيب تخزين (UUID عشوائي، لا عمود ترتيب في المخطط):
 *        - لو كل أزواج (مدين، دائن) في القيد فريدة (لا تكرار)، تُطابَق بالقيمة مباشرة — قطعي.
 *        - لو وُجد تكرار (نفس المبلغين في أكثر من سطر)، تُطابَق أسطر المجموعة المتكرِّرة فقط
 *          بترتيب "تسلسل السطر" في المرجع مقابل ترتيب فيزيائي تقريبي (ctid) في القيود المخزَّنة،
 *          وتُعلَّم في التقرير كـ"مطابقة بالترتيب داخل مجموعة متطابقة القيمة" ليراجعها المستخدم.
 *
 * قيود يزيد عدد أسطرها المخزَّنة عن عدد أسطر المرجع (أو ينقص) **لا تُصحَّح إطلاقاً** — لا التاريخ
 * ولا الوصف — بل تُدرَج في تقرير "قيود تحتاج قرارًا يدويًا" بكامل تفاصيل أسطرها المخزَّنة والمرجعية
 * معاً، لأن فحصاً يدوياً لعدة قيود من هذه الفئة (401، 724، ...) أظهر أن "الأسطر الزائدة" ليست بالضرورة
 * تكراراً حرفياً للأسطر الصحيحة نفسها، بل كتلة أسطر أخرى مختلفة (حسابات/مبالغ مغايرة) مُلحَقة
 * ومكرَّرة معها — حذفها تلقائياً بافتراض أنها "تكرار للصحيح" قد يكون خطأً؛ يلزم قرار بشري بعد مراجعة
 * التفاصيل الكاملة قبل أي حذف.
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/fix-armi-bulk-import-data.ts <مسار-الملف-المرجعي.csv> [--commit]
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const MEMO_ENTRY_NUMBER_RE = /قيد يدوي رقم\s*(\d+)/;
const EPSILON = 0.005;

interface ReferenceLine {
  entryNumber: number;
  lineSeq: number;
  date: string;
  accountOldName: string;
  debit: number;
  credit: number;
  description: string;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  return cleaned ? Number(cleaned) : 0;
}

/** محلّل CSV بسيط يدعم الحقول المقتبسة بـ"" (لازمة لأعمدة مثل "3,043.48 " التي تحوي فاصلة داخل quotes) */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { fields.push(cur); cur = ""; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
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
      entryNumber,
      lineSeq: Number(cols[1]),
      date: cols[2]?.trim(),
      accountOldName: cols[3]?.trim(),
      debit: parseAmount(cols[4] || "0"),
      credit: parseAmount(cols[5] || "0"),
      description: (cols[6] || "").trim(),
    };
    const arr = byEntry.get(entryNumber) || [];
    arr.push(refLine);
    byEntry.set(entryNumber, arr);
  }
  for (const arr of byEntry.values()) arr.sort((a, b) => a.lineSeq - b.lineSeq);
  return byEntry;
}

interface DbLine {
  id: string;
  debit: number;
  credit: number;
  description: string | null;
}
interface DbEntry {
  id: string;
  entryNumber: string | null;
  originalEntryNumber: number;
  date: string;
  memo: string | null;
  lines: DbLine[];
}

async function loadDbEntries(): Promise<DbEntry[]> {
  // ctid يعكس الترتيب الفيزيائي التقريبي للإدراج (لا ترتيب منطقي في المخطط أصلاً؛ id عشوائي تماماً
  // Randomuuid لا cuid) — يُستخدَم فقط كمرجّح ترتيب احتياطي عند تعادل القيم، لا كأساس مطابقة وحيد.
  const rows = await prisma.$queryRaw<
    { id: string; entryNumber: string | null; date: Date; memo: string | null; lineId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; description: string | null }[]
  >`
    SELECT je.id, je."entryNumber", je.date, je.memo, jel.id AS "lineId", jel.debit, jel.credit, jel.description
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
        id: row.id,
        entryNumber: row.entryNumber,
        originalEntryNumber: match ? Number(match[1]) : -1,
        date: row.date.toISOString().slice(0, 10),
        memo: row.memo,
        lines: [],
      };
      byEntryId.set(row.id, entry);
    }
    entry.lines.push({ id: row.lineId, debit: Number(row.debit), credit: Number(row.credit), description: row.description });
  }
  return [...byEntryId.values()];
}

type LineMatch = { dbLineId: string; refDescription: string; tie: boolean };

/** يطابق أسطر قيد مخزَّنة بأسطر مرجعية بنفس العدد، بالقيمة (مدين، دائن) — قطعي لو كانت كل الأزواج
 * فريدة، وإلا يطابق ضمن كل مجموعة متطابقة القيمة بالترتيب (ctid مقابل تسلسل السطر) ويُعلَّم tie=true. */
function matchLines(dbLines: DbLine[], refLines: ReferenceLine[]): { matches: LineMatch[]; ok: boolean } {
  if (dbLines.length !== refLines.length) return { matches: [], ok: false };
  const key = (d: number, c: number) => `${d.toFixed(2)}|${c.toFixed(2)}`;

  const dbByKey = new Map<string, DbLine[]>();
  dbLines.forEach((l) => {
    const k = key(l.debit, l.credit);
    (dbByKey.get(k) || dbByKey.set(k, []).get(k)!).push(l);
  });
  const refByKey = new Map<string, ReferenceLine[]>();
  refLines.forEach((l) => {
    const k = key(l.debit, l.credit);
    (refByKey.get(k) || refByKey.set(k, []).get(k)!).push(l);
  });

  if (dbByKey.size !== refByKey.size) return { matches: [], ok: false };

  const matches: LineMatch[] = [];
  for (const [k, dbGroup] of dbByKey) {
    const refGroup = refByKey.get(k);
    if (!refGroup || refGroup.length !== dbGroup.length) return { matches: [], ok: false };
    const tie = dbGroup.length > 1;
    // كلاهما بترتيبهما الطبيعي أصلاً (dbLines جاءت مرتبة بـctid، refLines مرتبة بتسلسل السطر)
    for (let i = 0; i < dbGroup.length; i++) {
      matches.push({ dbLineId: dbGroup[i].id, refDescription: refGroup[i].description, tie });
    }
  }
  return { matches, ok: true };
}

async function main() {
  const referencePath = process.argv[2];
  const commit = process.argv.includes("--commit");
  if (!referencePath) throw new Error("مرّر مسار الملف المرجعي كمعامل أول");
  if (!existsSync(referencePath)) throw new Error(`الملف غير موجود: ${referencePath}`);

  const reference = loadReference(referencePath);
  const dbEntries = await loadDbEntries();

  console.log(`قيود المرجع الفريدة: ${reference.size}`);
  console.log(`قيود bulk_import المخزَّنة لشركة أرمي: ${dbEntries.length}`);

  interface EntryFix {
    entryId: string;
    originalEntryNumber: number;
    dateChange: { from: string; to: string } | null;
    descriptionChanges: { lineId: string; from: string | null; to: string }[];
  }

  let dateFixes = 0;
  let descriptionFixes = 0;
  let tieMatchedEntries = 0;
  const needsManualReview: { originalEntryNumber: number; dbLines: DbLine[]; refLines: ReferenceLine[] }[] = [];
  const noReference: number[] = [];
  // كل قيد يحمل تصحيحاته الخاصة معاً (تاريخه + كل تحديثات وصف أسطره) — وحدة تنفيذ ذرّية واحدة لاحقاً،
  // بدل معاملة تفاعلية واحدة ضخمة تغطي آلاف القيود معاً (وهو تحديداً ما سبَّب P2028 سابقاً: انتهاء
  // مهلة Prisma التفاعلية الافتراضية (5 ثوانٍ) أثناء تنفيذ آلاف عمليات update داخل حلقة واحدة).
  const entryFixes: EntryFix[] = [];

  for (const entry of dbEntries) {
    if (entry.originalEntryNumber === -1) {
      console.log(`⚠️ تعذّر استخراج رقم القيد الأصلي من الـmemo: ${entry.id} / "${entry.memo}"`);
      continue;
    }
    const refLines = reference.get(entry.originalEntryNumber);
    if (!refLines) {
      noReference.push(entry.originalEntryNumber);
      continue;
    }

    // فحص تطابق الأسطر أولاً — قيد يحتاج قراراً يدوياً (عدد/قيم الأسطر لا تتطابق) لا يُلمَس إطلاقاً،
    // لا التاريخ ولا الوصف، حتى لو كان تاريخه المخزَّن مختلفاً عن المرجع.
    const { matches, ok } = matchLines(entry.lines, refLines);
    if (!ok) {
      needsManualReview.push({ originalEntryNumber: entry.originalEntryNumber, dbLines: entry.lines, refLines });
      continue;
    }

    const fix: EntryFix = { entryId: entry.id, originalEntryNumber: entry.originalEntryNumber, dateChange: null, descriptionChanges: [] };

    const correctDate = refLines[0].date;
    if (entry.date !== correctDate) {
      dateFixes++;
      fix.dateChange = { from: entry.date, to: correctDate };
    }
    let hadTie = false;
    for (const m of matches) {
      if (m.tie) hadTie = true;
      const dbLine = entry.lines.find((l) => l.id === m.dbLineId)!;
      if ((dbLine.description || "") !== m.refDescription) {
        descriptionFixes++;
        fix.descriptionChanges.push({ lineId: m.dbLineId, from: dbLine.description, to: m.refDescription });
      }
    }
    if (hadTie) tieMatchedEntries++;
    if (fix.dateChange || fix.descriptionChanges.length) entryFixes.push(fix);
  }

  console.log(`\n=== ملخص Dry-run ${commit ? "(سيُنفَّذ فعلياً الآن --commit)" : "(بلا أي كتابة)"} ===`);
  console.log(`قيود سيُصحَّح تاريخها: ${dateFixes}`);
  console.log(`أسطر سيُضاف/يُحدَّث وصفها: ${descriptionFixes}`);
  console.log(`  منها ضمن قيود فيها تعادل قيم (tie) اعتُمد فيها ترتيب تقريبي: ${tieMatchedEntries} قيداً`);
  console.log(`قيود بلا أي بيانات مرجعية (تُركت كما هي كلياً): ${noReference.length}${noReference.length ? " — أرقامها: " + noReference.join(", ") : ""}`);
  console.log(`قيود تحتاج قراراً يدوياً (عدد أسطر لا يطابق أو أزواج قيم لا تتطابق كمجموعة) — لم يُصحَّح فيها التاريخ ولا الوصف: ${needsManualReview.length}`);
  for (const r of needsManualReview) {
    console.log(`\n--- القيد الأصلي #${r.originalEntryNumber}: ${r.dbLines.length} سطراً مخزَّناً مقابل ${r.refLines.length} سطراً مرجعياً ---`);
    console.log("  المخزَّن فعلياً (مدين | دائن | الوصف الحالي):");
    r.dbLines.forEach((l) => console.log(`    ${l.debit.toFixed(2)} | ${l.credit.toFixed(2)} | ${l.description || "—"}`));
    console.log("  المرجع الصحيح (مدين | دائن | الوصف):");
    r.refLines.forEach((l) => console.log(`    ${l.debit.toFixed(2)} | ${l.credit.toFixed(2)} | ${l.accountOldName} | ${l.description}`));
  }

  if (!commit) {
    console.log("\n(وضع Dry-run — لم يُكتَب أي تغيير. أعد التشغيل بإضافة --commit للتنفيذ الفعلي بعد المراجعة والموافقة الصريحة.)");
    return;
  }

  console.log(`\n--commit مفعَّل: تنفيذ ${entryFixes.length} قيداً، كل قيد في معاملة قصيرة مستقلة (تاريخه + كل تحديثات وصف أسطره معاً)...`);
  console.log("إعادة تشغيل هذا الأمر لاحقاً (بعد أي انقطاع لأي سبب) آمنة تماماً: كل قيد يُعاد فحصه من حالته الفعلية الحالية، فالقيود المصحَّحة بالفعل تُكتشَف كمطابقة للمرجع فعلاً وتُتخطَّى بصمت بلا أي ازدواج.");

  let succeeded = 0;
  const failed: { originalEntryNumber: number; error: string }[] = [];
  for (let i = 0; i < entryFixes.length; i++) {
    const fix = entryFixes[i];
    try {
      const ops = [];
      if (fix.dateChange) {
        ops.push(prisma.journalEntry.update({ where: { id: fix.entryId }, data: { date: new Date(`${fix.dateChange.to}T00:00:00.000Z`) } }));
      }
      for (const dc of fix.descriptionChanges) {
        ops.push(prisma.journalEntryLine.update({ where: { id: dc.lineId }, data: { description: dc.to } }));
      }
      // صيغة $transaction المصفوفية (لا التفاعلية): تُرسَل كل عمليات هذا القيد كمعاملة واحدة قصيرة
      // بلا جلسة طويلة معرَّضة لانتهاء مهلة تفاعلية — ذرّية على مستوى القيد الواحد (كل تحديثاته
      // تنجح معاً أو تفشل معاً)، لا على مستوى التشغيلة كلها.
      await prisma.$transaction(ops);
      succeeded++;
    } catch (err) {
      failed.push({ originalEntryNumber: fix.originalEntryNumber, error: err instanceof Error ? err.message : String(err) });
    }
    if ((i + 1) % 200 === 0 || i === entryFixes.length - 1) {
      console.log(`  تقدُّم: ${i + 1}/${entryFixes.length} قيداً (نجح ${succeeded}، فشل ${failed.length})`);
    }
  }

  console.log(`\nتم بنجاح: ${succeeded} قيداً من ${entryFixes.length}.`);
  if (failed.length) {
    console.log(`\n⚠️ فشل ${failed.length} قيداً أثناء التنفيذ (لم تُطبَّق تصحيحاتها، ولم تتأثر أي قيود أخرى) — أعد تشغيل نفس الأمر لإعادة محاولتها فقط:`);
    failed.forEach((f) => console.log(`  #${f.originalEntryNumber}: ${f.error}`));
  }
  console.log(`لم يُلمَس إطلاقاً: ${needsManualReview.length} قيداً (عدم تطابق عدد/قيم الأسطر) — بانتظار قرار يدوي منفصل.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
