/**
 * سكريبت تحقيق قرائي فقط (بلا أي تعديل/إنشاء/حذف) — تسوية شاملة بين المصدر الكامل (5 ملفات كشف
 * حساب من قيود، تُغطي كل الحسابات الـ83) وبين كل ما هو مستورد فعلياً في أثر لشركة أرمي
 * (sourceModule=bulk_import)، بلا أي افتراض مسبق بأن المشاكل المعروفة سابقاً (729 تاريخ خاطئ،
 * 11 قيداً بأسطر زائدة) هي كل ما فيه مشكلة.
 *
 * المصدر: reference/armi_statement_{1..5}_*.csv — نسخة CSV من ملفات Excel الخمسة المرفقة
 * (كل ملف = تصنيف رئيسي كامل: أصول/التزامات/حقوق ملكية/إيرادات/مصاريف)، بعمود "المرجع" الخام كما
 * هو في قيود (رقمي، أو PYT+رقم، أو INV+رقم، أو أي نمط آخر يُكتشَف هنا تلقائياً — لا نمط مُفترَض
 * سلفاً). قيد واحد في قيود قد يظهر بسطر واحد في كل ملف من الملفات التي تخصّ الحسابات التي لمسها،
 * لذلك يجب التجميع بالمرجع عبر الملفات الخمسة معاً لإعادة بناء القيد الكامل بكل أسطره.
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/investigate-armi-full-reconciliation.ts [companyId]
 *
 * companyId اختياري (افتراضياً معرّف أرمي الحقيقي) — يُستخدَم فقط للاختبار المحلي على شركة تجريبية
 * تحاكي نفس الأنماط قبل التشغيل الفعلي على الإنتاج.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// عميل Prisma مستقل تماماً (لا استيراد src/lib/prisma.ts) — نفس أسلوب investigate-armi-bulk-import-dates.ts
const prisma = new PrismaClient();

const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";

const REFERENCE_FILES = [
  "armi_statement_1_assets.csv",
  "armi_statement_2_liabilities.csv",
  "armi_statement_3_equity.csv",
  "armi_statement_4_revenue.csv",
  "armi_statement_5_expenses.csv",
];

// النمط الوحيد الموثّق فعلياً من عمل سابق (fix-armi-bulk-import-data.ts). أي نمط ثانٍ (مثل
// "N ... Kashif Ali" المذكور) غير موثَّق بكود سابق يمكن الاستشهاد به بثقة — لذلك لا نفترضه هنا،
// ونكتفي بطباعة كل الـmemo التي لم تُطابق هذا النمط الأساسي في قسم تشخيصي منفصل ليُراجَعها المستخدم
// بنفسه ويؤكد الصيغة الدقيقة قبل أي وثوق بمطابقة تعتمد عليها.
const MEMO_ENTRY_NUMBER_RE = /قيد يدوي رقم\s*(\d+)/;
// محاولة احتياطية حذرة: رقم في أول الـmemo مباشرة (يغطي احتمال نمط "N ... Kashif Ali" لو كان
// الرقم فعلاً في البداية) — نتائجها تُعلَّم صراحة كـ"غير مؤكدة" في التقرير، لا تُدمَج بصمت مع
// المطابقات الواثقة من النمط الأساسي.
const FALLBACK_LEADING_NUMBER_RE = /^(\d+)\b/;

export type RefPattern = "NUMERIC" | "PYT" | "INV" | "OTHER";

export interface ExcelLine {
  classification: string;
  date: string;
  account: string;
  type: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
}

export interface ExcelEntry {
  reference: string;
  pattern: RefPattern;
  lines: ExcelLine[];
  totalDebit: number;
  totalCredit: number;
  dates: Set<string>;
}

// شكل قيد أثر كما تحتاجه منطق المطابقة فقط (مطابق لنتيجة استعلام Prisma الفعلي، ومُعاد استخدامه
// حرفياً في سكريبت الاختبار المحلي ببيانات تركيبية بلا أي اتصال DB حقيقي).
export interface DbEntryLike {
  id: string;
  entryNumber: string;
  memo: string | null;
  date: Date;
  lines: { debit: unknown; credit: unknown; account: { name: string } | null }[];
}

export function parseAmount(raw: string): number {
  const s = (raw || "").trim();
  if (!s || s === "-") return 0;
  const negative = s.startsWith("(") && s.endsWith(")");
  const cleaned = s.replace(/[(),]/g, "").replace(/,/g, "").trim();
  const n = Number(cleaned.replace(/,/g, ""));
  if (Number.isNaN(n)) return 0;
  return negative ? -n : n;
}

// محلّل CSV بسيط يدعم الاقتباس المزدوج (نفس أسلوب investigate-armi-bulk-import-dates.ts، موسّعاً
// لدعم فواصل داخل حقول مقتبَسة — أوصاف قيود قيود تحتوي فواصل أحياناً).
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function classifyReference(ref: string): RefPattern {
  if (/^\d+$/.test(ref)) return "NUMERIC";
  if (/^PYT\d+$/i.test(ref)) return "PYT";
  if (/^INV\d+$/i.test(ref)) return "INV";
  return "OTHER";
}

export function loadExcelLines(): ExcelLine[] {
  const lines: ExcelLine[] = [];
  for (const file of REFERENCE_FILES) {
    const fullPath = path.join(__dirname, "..", "reference", file);
    const raw = readFileSync(fullPath, "utf-8").replace(/^﻿/, "");
    const rows = raw.split(/\r?\n/).filter((l) => l.length > 0);
    const header = parseCsvLine(rows[0]);
    const idx = {
      classification: header.indexOf("التصنيف"),
      date: header.indexOf("التاريخ"),
      account: header.indexOf("الحساب"),
      type: header.indexOf("النوع"),
      desc: header.indexOf("وصف العملية"),
      ref: header.indexOf("المرجع"),
      debit: header.indexOf("مدين"),
      credit: header.indexOf("دائن"),
    };
    for (const row of rows.slice(1)) {
      const cols = parseCsvLine(row);
      const reference = (cols[idx.ref] || "").trim();
      if (!reference) continue;
      lines.push({
        classification: cols[idx.classification],
        date: (cols[idx.date] || "").trim(),
        account: (cols[idx.account] || "").trim(),
        type: (cols[idx.type] || "").trim(),
        description: (cols[idx.desc] || "").trim(),
        reference,
        debit: parseAmount(cols[idx.debit]),
        credit: parseAmount(cols[idx.credit]),
      });
    }
  }
  return lines;
}

export function groupExcelEntries(lines: ExcelLine[]): Map<string, ExcelEntry> {
  const map = new Map<string, ExcelEntry>();
  for (const line of lines) {
    let entry = map.get(line.reference);
    if (!entry) {
      entry = { reference: line.reference, pattern: classifyReference(line.reference), lines: [], totalDebit: 0, totalCredit: 0, dates: new Set() };
      map.set(line.reference, entry);
    }
    entry.lines.push(line);
    entry.totalDebit += line.debit;
    entry.totalCredit += line.credit;
    entry.dates.add(line.date);
  }
  return map;
}

// توقيع خطوط قيد لمطابقة PYT/INV: مضاعفة (مدين أو دائن الفعلي، بتقريب هللتين) بلا اعتماد على
// النص أو اسم الحساب (يختلف أحياناً بين قيود وأثر)، فقط الأرقام والتاريخ.
export function lineSignature(amounts: number[]): string {
  return amounts
    .map((a) => Math.round(a * 100))
    .filter((a) => a !== 0)
    .sort((a, b) => a - b)
    .join("|");
}

// شكل موحَّد لعنصر "قيد أثر بعد استخراج رقمه الأصلي من الـmemo" — مُصدَّر ليستخدمه سكريبت
// الاختبار المحلي بالضبط كما هو، بلا أي تكرار للمنطق.
export interface DbExtracted<T extends DbEntryLike = DbEntryLike> {
  entry: T;
  originalNumber: number | null;
  matchQuality: "primary" | "fallback" | "none";
}

export interface ReconciliationResult<T extends DbEntryLike = DbEntryLike> {
  dbExtracted: DbExtracted<T>[];
  duplicateNumbers: [number, DbExtracted<T>[]][];
  exactMatches: string[];
  missingEntirely: ExcelEntry[];
  moreLinesInAthar: { excel: ExcelEntry; db: T }[];
  fewerLinesInAthar: { excel: ExcelEntry; db: T }[];
  needsManualReview: { reference: string; reason: string }[];
  extraInAthar: DbExtracted<T>[];
}

// المنطق الخالص الكامل للمطابقة (خطوات 2-5) — لا قراءة ملفات ولا اتصال DB هنا إطلاقاً، فقط
// بيانات مُمرَّرة، لضمان أن سكريبت الاختبار المحلي بالبيانات التركيبية يفحص نفس الكود الحقيقي
// المستخدَم على الإنتاج، لا نسخة منه معاد كتابتها.
export function matchEntries<T extends DbEntryLike>(excelEntries: Map<string, ExcelEntry>, dbEntries: T[]): ReconciliationResult<T> {
  const dbExtracted: DbExtracted<T>[] = dbEntries.map((entry) => {
    const primary = entry.memo ? MEMO_ENTRY_NUMBER_RE.exec(entry.memo) : null;
    if (primary) return { entry, originalNumber: Number(primary[1]), matchQuality: "primary" as const };
    const fallback = entry.memo ? FALLBACK_LEADING_NUMBER_RE.exec(entry.memo) : null;
    if (fallback) return { entry, originalNumber: Number(fallback[1]), matchQuality: "fallback" as const };
    return { entry, originalNumber: null, matchQuality: "none" as const };
  });

  // خريطة originalNumber -> كل القيود المستوردة التي استُخرج لها هذا الرقم (بالنمط الأساسي فقط —
  // الاحتياطي يُعامَل بحذر منفصل أدناه لتفادي تلويث المطابقة الواثقة).
  const byOriginalNumber = new Map<number, DbExtracted<T>[]>();
  for (const d of dbExtracted) {
    if (d.matchQuality !== "primary" || d.originalNumber === null) continue;
    const arr = byOriginalNumber.get(d.originalNumber) || [];
    arr.push(d);
    byOriginalNumber.set(d.originalNumber, arr);
  }
  const duplicateNumbers = [...byOriginalNumber.entries()].filter(([, arr]) => arr.length > 1);

  const claimedDbEntryIds = new Set<string>();

  // ---------- 3) مطابقة القيود الرقمية ----------
  const exactMatches: string[] = [];
  const missingEntirely: ExcelEntry[] = [];
  const moreLinesInAthar: { excel: ExcelEntry; db: T }[] = [];
  const fewerLinesInAthar: { excel: ExcelEntry; db: T }[] = [];
  const needsManualReview: { reference: string; reason: string }[] = [];

  for (const excelEntry of excelEntries.values()) {
    if (excelEntry.pattern !== "NUMERIC") continue;
    const num = Number(excelEntry.reference);
    const candidates = byOriginalNumber.get(num);
    if (!candidates || candidates.length === 0) {
      missingEntirely.push(excelEntry);
      continue;
    }
    if (candidates.length > 1) {
      needsManualReview.push({ reference: excelEntry.reference, reason: `عدة قيود في أثر استُخرج لها نفس الرقم الأصلي ${num}` });
      candidates.forEach((c) => claimedDbEntryIds.add(c.entry.id));
      continue;
    }
    const db = candidates[0].entry;
    claimedDbEntryIds.add(db.id);
    const dbLineCount = db.lines.length;
    const excelLineCount = excelEntry.lines.length;
    const dbTotalDebit = db.lines.reduce((s, l) => s + Number(l.debit), 0);
    const dbTotalCredit = db.lines.reduce((s, l) => s + Number(l.credit), 0);
    const amountsMatch = Math.abs(dbTotalDebit - excelEntry.totalDebit) < 0.02 && Math.abs(dbTotalCredit - excelEntry.totalCredit) < 0.02;

    if (dbLineCount === excelLineCount && amountsMatch) {
      exactMatches.push(excelEntry.reference);
    } else if (dbLineCount > excelLineCount) {
      moreLinesInAthar.push({ excel: excelEntry, db });
    } else if (dbLineCount < excelLineCount) {
      fewerLinesInAthar.push({ excel: excelEntry, db });
    } else {
      // نفس عدد الأسطر لكن المبالغ الإجمالية مختلفة — حالة غامضة لم تكن ضمن التصنيفات المطلوبة صراحة
      needsManualReview.push({ reference: excelEntry.reference, reason: `نفس عدد الأسطر (${dbLineCount}) لكن الإجمالي مختلف: قيود مدين=${excelEntry.totalDebit.toFixed(2)}/دائن=${excelEntry.totalCredit.toFixed(2)} مقابل أثر مدين=${dbTotalDebit.toFixed(2)}/دائن=${dbTotalCredit.toFixed(2)}` });
    }
  }

  // ---------- 4) مطابقة PYT/INV بالتاريخ+المبلغ (بلا اعتماد على الـmemo) ----------
  const unclaimedDb = dbExtracted.filter((d) => !claimedDbEntryIds.has(d.entry.id));
  const pytInvEntries = [...excelEntries.values()].filter((e) => e.pattern === "PYT" || e.pattern === "INV");

  for (const excelEntry of pytInvEntries) {
    const excelSig = lineSignature(excelEntry.lines.map((l) => (l.debit !== 0 ? l.debit : -l.credit)));
    const excelDates = [...excelEntry.dates];
    const candidates = unclaimedDb.filter((d) => {
      const dbDate = d.entry.date.toISOString().slice(0, 10);
      if (!excelDates.includes(dbDate)) return false;
      const dbSig = lineSignature(d.entry.lines.map((l) => Number(l.debit) !== 0 ? Number(l.debit) : -Number(l.credit)));
      return dbSig === excelSig;
    });

    if (candidates.length === 0) {
      missingEntirely.push(excelEntry);
    } else if (candidates.length > 1) {
      needsManualReview.push({ reference: excelEntry.reference, reason: `عدة قيود مرشَّحة في أثر بنفس التاريخ/المبالغ (${candidates.length} مرشَّحاً) — لا يمكن التأكيد تلقائياً` });
      candidates.forEach((c) => claimedDbEntryIds.add(c.entry.id));
    } else {
      const db = candidates[0].entry;
      claimedDbEntryIds.add(db.id);
      const dbLineCount = db.lines.length;
      const excelLineCount = excelEntry.lines.length;
      if (dbLineCount === excelLineCount) exactMatches.push(excelEntry.reference);
      else if (dbLineCount > excelLineCount) moreLinesInAthar.push({ excel: excelEntry, db });
      else fewerLinesInAthar.push({ excel: excelEntry, db });
    }
  }

  // ---------- 5) قيود زائدة في أثر بلا أي مصدر في قيود ----------
  const extraInAthar = dbExtracted.filter((d) => !claimedDbEntryIds.has(d.entry.id));

  return { dbExtracted, duplicateNumbers, exactMatches, missingEntirely, moreLinesInAthar, fewerLinesInAthar, needsManualReview, extraInAthar };
}

async function main() {
  const companyId = process.argv[2] || DEFAULT_ARMI_COMPANY_ID;
  console.log(`=== تسوية شاملة — companyId=${companyId} ===\n`);

  // ---------- 1) تحميل واستخراج كل قيود قيود ----------
  const excelLines = loadExcelLines();
  console.log(`إجمالي أسطر المعاملات في الملفات الخمسة (بعد استبعاد صفوف الرصيد الافتتاحي/الختامي/صافي الحركة): ${excelLines.length}`);

  const excelEntries = groupExcelEntries(excelLines);
  const byPattern = { NUMERIC: 0, PYT: 0, INV: 0, OTHER: 0 } as Record<RefPattern, number>;
  for (const e of excelEntries.values()) byPattern[e.pattern]++;
  console.log(`إجمالي القيود الفريدة (بالمرجع) في قيود: ${excelEntries.size}`);
  console.log(`  - رقمية (NUMERIC): ${byPattern.NUMERIC}`);
  console.log(`  - سند قبض (PYT+رقم): ${byPattern.PYT}`);
  console.log(`  - فاتورة مبيعات (INV+رقم): ${byPattern.INV}`);
  console.log(`  - أنماط أخرى غير معروفة (OTHER): ${byPattern.OTHER}`);
  if (byPattern.OTHER > 0) {
    console.log(`\n⚠️ وُجدت أنماط مرجع غير معروفة — عيّنة:`);
    [...excelEntries.values()].filter((e) => e.pattern === "OTHER").slice(0, 15).forEach((e) => console.log(`  "${e.reference}"`));
  }

  // ---------- 2) تحميل كل القيود المستوردة فعلياً ----------
  const dbEntries = await prisma.journalEntry.findMany({
    where: { companyId, sourceModule: "bulk_import" },
    include: { lines: { include: { account: true } } },
    orderBy: { entryNumber: "asc" },
  });
  console.log(`\nإجمالي القيود المستوردة فعلياً (sourceModule=bulk_import) في أثر: ${dbEntries.length}`);

  const result = matchEntries(excelEntries, dbEntries);
  const { dbExtracted, duplicateNumbers, exactMatches, missingEntirely, moreLinesInAthar, fewerLinesInAthar, needsManualReview, extraInAthar } = result;

  const noMemoMatch = dbExtracted.filter((d) => d.matchQuality === "none");
  const fallbackMatch = dbExtracted.filter((d) => d.matchQuality === "fallback");
  console.log(`\nاستخراج رقم القيد الأصلي من الـmemo:`);
  console.log(`  - بالنمط الأساسي الموثَّق ("قيد يدوي رقم N"): ${dbExtracted.filter((d) => d.matchQuality === "primary").length}`);
  console.log(`  - بنمط احتياطي غير مؤكَّد (رقم في بداية الـmemo): ${fallbackMatch.length} — راجع هذه يدوياً، النمط غير موثَّق سلفاً`);
  console.log(`  - بلا أي رقم مستخرَج إطلاقاً: ${noMemoMatch.length}`);
  if (fallbackMatch.length) {
    console.log(`\n  عيّنة من مطابقات النمط الاحتياطي (تحقّق من صحتها يدوياً):`);
    fallbackMatch.slice(0, 10).forEach((d) => console.log(`    entryNumber=${d.entry.entryNumber} originalNumber(احتياطي)=${d.originalNumber} memo="${d.entry.memo}"`));
  }
  if (noMemoMatch.length) {
    console.log(`\n  عيّنة ممّا بلا رقم مستخرَج (مرشّح لمطابقة PYT/INV بالمبلغ+التاريخ):`);
    noMemoMatch.slice(0, 15).forEach((d) => console.log(`    entryNumber=${d.entry.entryNumber} date=${d.entry.date.toISOString().slice(0, 10)} memo="${d.entry.memo}"`));
  }
  if (duplicateNumbers.length) {
    console.log(`\n⚠️ أرقام قيود أصلية استُخرجت لأكثر من قيد مستورَد واحد في أثر (قيد كامل مكرَّر، لا مجرد أسطر زائدة):`);
    duplicateNumbers.forEach(([num, arr]) => console.log(`    رقم ${num}: ${arr.map((d) => d.entry.entryNumber).join(", ")}`));
  }

  // ================= التقرير =================
  console.log(`\n\n========================================`);
  console.log(`=============  التقرير الكامل  =============`);
  console.log(`========================================\n`);

  console.log(`1) قيود مطابقة تماماً (نفس عدد الأسطر ونفس المبالغ): ${exactMatches.length}`);

  console.log(`\n2) قيود غائبة تماماً من أثر: ${missingEntirely.length}`);
  const missingByPattern = { NUMERIC: 0, PYT: 0, INV: 0, OTHER: 0 } as Record<RefPattern, number>;
  missingEntirely.forEach((e) => missingByPattern[e.pattern]++);
  console.log(`   حسب نمط المرجع: رقمي=${missingByPattern.NUMERIC} | PYT=${missingByPattern.PYT} | INV=${missingByPattern.INV} | أخرى=${missingByPattern.OTHER}`);
  if (missingEntirely.length) {
    console.log(`\n   التفصيل الكامل:`);
    missingEntirely
      .sort((a, b) => a.reference.localeCompare(b.reference))
      .forEach((e) => {
        console.log(`   --- المرجع: ${e.reference} (${e.pattern}) ---`);
        e.lines.forEach((l) => console.log(`       ${l.date} | ${l.account} | ${l.type} | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)} | ${l.description}`));
      });
  }

  console.log(`\n3) قيود بعدد أسطر أكثر في أثر (تكرار): ${moreLinesInAthar.length}`);
  if (moreLinesInAthar.length) {
    moreLinesInAthar.forEach(({ excel, db }) => {
      console.log(`   --- المرجع: ${excel.reference} — قيود=${excel.lines.length} سطراً، أثر (entryNumber=${db.entryNumber})=${db.lines.length} سطراً ---`);
      console.log(`       أسطر قيود: ${excel.lines.map((l) => `مدين=${l.debit.toFixed(2)}/دائن=${l.credit.toFixed(2)}`).join(" | ")}`);
      console.log(`       أسطر أثر: ${db.lines.map((l) => `${l.account?.name}: مدين=${Number(l.debit).toFixed(2)}/دائن=${Number(l.credit).toFixed(2)}`).join(" | ")}`);
    });
  }

  console.log(`\n4) قيود بعدد أسطر أقل في أثر (نقص جزئي): ${fewerLinesInAthar.length}`);
  if (fewerLinesInAthar.length) {
    fewerLinesInAthar.forEach(({ excel, db }) => {
      console.log(`   --- المرجع: ${excel.reference} — قيود=${excel.lines.length} سطراً، أثر (entryNumber=${db.entryNumber})=${db.lines.length} سطراً ---`);
      console.log(`       أسطر قيود: ${excel.lines.map((l) => `${l.account}: مدين=${l.debit.toFixed(2)}/دائن=${l.credit.toFixed(2)}`).join(" | ")}`);
      console.log(`       أسطر أثر: ${db.lines.map((l) => `${l.account?.name}: مدين=${Number(l.debit).toFixed(2)}/دائن=${Number(l.credit).toFixed(2)}`).join(" | ")}`);
    });
  }

  console.log(`\n5) قيود في أثر بلا أي مصدر في قيود إطلاقاً: ${extraInAthar.length}`);
  if (extraInAthar.length) {
    extraInAthar.forEach((d) => {
      console.log(`   entryNumber=${d.entry.entryNumber} | date=${d.entry.date.toISOString().slice(0, 10)} | memo="${d.entry.memo}" | أسطر=${d.entry.lines.length}`);
    });
  }

  console.log(`\n6) يحتاج مراجعة يدوية (غموض في المطابقة): ${needsManualReview.length}`);
  needsManualReview.forEach((r) => console.log(`   المرجع/الحالة: ${r.reference} — ${r.reason}`));

  // ---------- الأثر المالي الإجمالي للقيود الناقصة ----------
  console.log(`\n\n=== الأثر المالي الإجمالي للقيود الناقصة (غائبة بالكامل + الأسطر الناقصة من قيود موجودة جزئياً) ===`);
  const impactByAccount = new Map<string, { debit: number; credit: number; count: number }>();
  const addImpact = (account: string, debit: number, credit: number) => {
    const cur = impactByAccount.get(account) || { debit: 0, credit: 0, count: 0 };
    cur.debit += debit;
    cur.credit += credit;
    cur.count += 1;
    impactByAccount.set(account, cur);
  };
  missingEntirely.forEach((e) => e.lines.forEach((l) => addImpact(l.account, l.debit, l.credit)));
  fewerLinesInAthar.forEach(({ excel, db }) => {
    // الأسطر التي في قيود ولا مقابل مباشر واضح لها في أثر — تقدير مبسّط: كل أسطر الفرق بالعدد فقط
    // (لا نحاول مطابقة سطراً بسطر هنا، فقط نُبلغ حجم الفجوة الإجمالي على مستوى القيد بالكامل ليُراجَع يدوياً)
    const missingCount = excel.lines.length - db.lines.length;
    addImpact(`(جزئي) ${excel.reference} — ${missingCount} سطر مفقود تقديرياً`, excel.totalDebit - db.lines.reduce((s, l) => s + Number(l.debit), 0), excel.totalCredit - db.lines.reduce((s, l) => s + Number(l.credit), 0));
  });
  let grandDebit = 0, grandCredit = 0;
  for (const [account, v] of [...impactByAccount.entries()].sort((a, b) => b[1].debit + b[1].credit - (a[1].debit + a[1].credit))) {
    console.log(`   ${account}: ${v.count} سطر | مدين=${v.debit.toFixed(2)} | دائن=${v.credit.toFixed(2)}`);
    grandDebit += v.debit;
    grandCredit += v.credit;
  }
  console.log(`\n   الإجمالي الكلي: مدين=${grandDebit.toFixed(2)} | دائن=${grandCredit.toFixed(2)}`);

  console.log(`\n\n=== ملخص نهائي ===`);
  console.log(`قيود قيود الفريدة: ${excelEntries.size}`);
  console.log(`قيود أثر (bulk_import): ${dbEntries.length}`);
  console.log(`مطابق تماماً: ${exactMatches.length}`);
  console.log(`غائب بالكامل: ${missingEntirely.length}`);
  console.log(`أسطر أكثر في أثر: ${moreLinesInAthar.length}`);
  console.log(`أسطر أقل في أثر: ${fewerLinesInAthar.length}`);
  console.log(`زائد في أثر بلا مصدر: ${extraInAthar.length}`);
  console.log(`يحتاج مراجعة يدوية: ${needsManualReview.length}`);
}

// يُشغَّل فقط عند تنفيذ هذا الملف مباشرة (npx tsx ...)، وليس عند استيراده كوحدة — يستوردها
// سكريبت الاختبار المحلي test-armi-reconciliation-logic.ts لإعادة استخدام matchEntries فقط،
// بلا أي اتصال DB أو قراءة ملفات CSV حقيقية أثناء الاختبار.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
