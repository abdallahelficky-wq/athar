/**
 * سكريبت تصحيح لسبعة قيود فقط من الإحدى عشرة المعروفة سابقاً بمشاكل "أسطر زائدة"
 * (401, 405, 496, 540, 600, 612, 627) — راجعها المستخدم يدوياً بالرجوع مباشرة لنظام قيود
 * (PDF الأصلي) وأكّد أن الملفات المرجعية الخمسة (reference/armi_statement_*.csv) دقيقة تماماً
 * لهذه السبعة بلا أي استثناء، بما فيها التواريخ.
 *
 * **الأربعة الباقية من الإحدى عشرة (688, 724, 733, 1333) خارج نطاق هذا السكريبت كلياً — لا يُقرَأ
 * ولا يُكتَب أي منها هنا بأي شكل، لا تزال بانتظار مراجعة يدوية منفصلة.**
 *
 * لكل قيد من السبعة:
 *   1. يحذف كل أسطره الحالية المخزَّنة، ويعيد كتابتها بالضبط كما في الملف المرجعي (نفس عدد الأسطر،
 *      نفس المبالغ، نفس الحسابات — بمطابقة اسم دقيقة تماماً فقط، لا تخمين).
 *   2. يصحح تاريخ القيد إن اختلف عن التاريخ الصحيح في قيود (نفس المصدر الذي تحقق منه المستخدم
 *      يدوياً — لا قائمة تواريخ منفصلة مُدخَلة يدوياً هنا لتفادي أي تعارض بين مصدرين).
 *   3. يحدّث الـmemo بالنص الإنجليزي الذي راجعه المستخدم من المصدر الأصلي حرفياً (بما في ذلك أي
 *      خطأ إملائي أصلي مثل "expesne" — يُحافَظ عليه كما هو بدل "تصحيحه" لأنه نص المصدر نفسه).
 *   4. يتحقق من توازن مدين/دائن، ومن عدم وقوع تاريخ القيد في أو قبل تاريخ إقفال السنة المالية.
 *
 * كل قيد يُعالَج بمعزل تام (معاملة Prisma مستقلة له) — فشل قيد واحد لا يوقف تصحيح البقية.
 * Idempotency: لو كانت الأسطر الحالية (بالقيمة والحساب) والتاريخ والـmemo مطابقة للمستهدَف بالفعل،
 * يُتخطَّى القيد بصمت (لا حذف ولا إعادة كتابة غير ضرورية).
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/fix-armi-seven-entries.ts [companyId] [--commit]
 */
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadExcelLines, groupExcelEntries, type ExcelEntry } from "./investigate-armi-full-reconciliation";

const prisma = new PrismaClient();
const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const MEMO_ENTRY_NUMBER_RE = /قيد يدوي رقم\s*(\d+)/;
const BALANCE_EPSILON = 0.01;

const TARGET_ENTRY_NUMBERS = [401, 405, 496, 540, 600, 612, 627];

// النص الإنجليزي الأصلي كما راجعه المستخدم من مصدر قيود مباشرة (PDF) — يُحافَظ حرفياً بما فيه أي
// خطأ إملائي أصلي (401: "expesne").
const CONFIRMED_MEMOS: Record<number, string> = {
  401: "Office maintenance expesne",
  405: "Funds Paid to Islam for travelling expense for Badr to Jeddah",
  496: "Mobile bill expense STC Bill (Aala Bill)",
  540: "Staff food expense paid by eslam",
  600: "Islam paid repair maintenance expense for the factory, Iron technician work",
  612: "Oxygen cylinder for factory paid by Islam Qty 5",
  627: "Omran Paid to Ashraf Travelling Expense and send funds to Aala for purchased a vehicle for display at the factory",
};

function amountKey(debit: number, credit: number): string {
  return `${Math.round(debit * 100)}|${Math.round(credit * 100)}`;
}

interface DbLine {
  id: string;
  accountId: string;
  accountName: string;
  debit: number;
  credit: number;
}
interface DbEntry {
  id: string;
  entryNumber: string;
  date: string;
  memo: string | null;
  lines: DbLine[];
}

async function loadDbEntry(companyId: string, originalNumber: number): Promise<DbEntry | null> {
  const entries = await prisma.journalEntry.findMany({
    where: { companyId, sourceModule: "bulk_import" },
    include: { lines: { include: { account: true } } },
  });
  for (const entry of entries) {
    const m = entry.memo ? MEMO_ENTRY_NUMBER_RE.exec(entry.memo) : null;
    if (m && Number(m[1]) === originalNumber) {
      return {
        id: entry.id,
        entryNumber: entry.entryNumber,
        date: entry.date.toISOString().slice(0, 10),
        memo: entry.memo,
        lines: entry.lines.map((l) => ({ id: l.id, accountId: l.accountId, accountName: l.account?.name || "", debit: Number(l.debit), credit: Number(l.credit) })),
      };
    }
  }
  return null;
}

interface ResolvedLine {
  accountId: string;
  accountName: string;
  debit: number;
  credit: number;
}

interface PreparedFix {
  originalNumber: number;
  dbEntryId: string;
  targetDate: string;
  targetMemo: string;
  resolvedLines: ResolvedLine[];
  currentDate: string;
  currentMemo: string | null;
  currentLines: DbLine[];
  dateChanged: boolean;
  memoChanged: boolean;
  linesAlreadyCorrect: boolean;
}

function linesMatch(current: DbLine[], target: ResolvedLine[]): boolean {
  if (current.length !== target.length) return false;
  const currentCounts = new Map<string, number>();
  for (const l of current) {
    const k = `${l.accountId}|${amountKey(l.debit, l.credit)}`;
    currentCounts.set(k, (currentCounts.get(k) || 0) + 1);
  }
  for (const l of target) {
    const k = `${l.accountId}|${amountKey(l.debit, l.credit)}`;
    const have = currentCounts.get(k) || 0;
    if (have === 0) return false;
    currentCounts.set(k, have - 1);
  }
  return [...currentCounts.values()].every((c) => c === 0);
}

// المنطق الكامل (بعد تحليل argv) — مُصدَّر ليُستدعى مباشرة من اختبار تكامل محلي على شركة تجريبية
// (بلا المرور عبر CLI)، وأيضاً من main() الفعلي أدناه.
export async function run(companyId: string, commit: boolean) {
  console.log(`=== تصحيح سبعة قيود أرمي (401, 405, 496, 540, 600, 612, 627) — companyId=${companyId} ${commit ? "(--commit: سيُنفَّذ فعلياً)" : "(Dry-run، بلا أي كتابة)"} ===\n`);

  const excelLines = loadExcelLines();
  const excelEntries = groupExcelEntries(excelLines);

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, tenantId: true, fiscalYearClosingDate: true } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);

  // شجرة حسابات الشركة — لمطابقة اسم الحساب في قيود بحساب فعلي، بمطابقة نصية دقيقة فقط
  const accounts = await prisma.account.findMany({
    where: { tenantId: company.tenantId, companyId, isPosting: true, isArchived: false, isActive: true },
    select: { id: true, code: true, name: true },
  });
  const byName = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const key = a.name.trim();
    byName.set(key, [...(byName.get(key) || []), a]);
  }

  const prepared: PreparedFix[] = [];
  const problems: string[] = [];

  for (const num of TARGET_ENTRY_NUMBERS) {
    const correctEntry = excelEntries.get(String(num));
    if (!correctEntry) {
      problems.push(`القيد ${num}: لا يوجد مرجع في قيود لهذا الرقم — غير متوقَّع، تحقق يدوياً.`);
      continue;
    }
    if (correctEntry.dates.size !== 1) {
      problems.push(`القيد ${num}: أسطره المرجعية موزَّعة على أكثر من تاريخ (${[...correctEntry.dates].join(", ")}) — لا يمكن المتابعة آلياً.`);
      continue;
    }
    const diff = correctEntry.totalDebit - correctEntry.totalCredit;
    if (Math.abs(diff) > BALANCE_EPSILON) {
      problems.push(`القيد ${num}: المرجع نفسه غير متوازن (مدين=${correctEntry.totalDebit.toFixed(2)}, دائن=${correctEntry.totalCredit.toFixed(2)}) — توقف، راجع الملف المرجعي.`);
      continue;
    }

    const dbEntry = await loadDbEntry(companyId, num);
    if (!dbEntry) {
      problems.push(`القيد ${num}: لم يُعثَر عليه في أثر بهذا الرقم الأصلي (استخراج المرجع من الـmemo) — تحقق يدوياً.`);
      continue;
    }

    // مطابقة أسماء الحسابات — دقيقة تماماً، بلا تخمين
    const resolvedLines: ResolvedLine[] = [];
    let accountProblem = false;
    for (const line of correctEntry.lines) {
      const candidates = byName.get(line.account.trim()) || [];
      if (candidates.length === 1) {
        resolvedLines.push({ accountId: candidates[0].id, accountName: candidates[0].name, debit: line.debit, credit: line.credit });
      } else if (candidates.length === 0) {
        problems.push(`القيد ${num}: الحساب "${line.account}" غير موجود في شجرة حسابات الشركة — لا يمكن تصحيح هذا القيد حتى يُحل.`);
        accountProblem = true;
      } else {
        problems.push(`القيد ${num}: الحساب "${line.account}" غامض (${candidates.length} حسابات بنفس الاسم) — لا يمكن الربط تلقائياً بثقة.`);
        accountProblem = true;
      }
    }
    if (accountProblem) continue;

    const targetDate = [...correctEntry.dates][0];
    const targetMemo = CONFIRMED_MEMOS[num];

    prepared.push({
      originalNumber: num,
      dbEntryId: dbEntry.id,
      targetDate,
      targetMemo,
      resolvedLines,
      currentDate: dbEntry.date,
      currentMemo: dbEntry.memo,
      currentLines: dbEntry.lines,
      dateChanged: dbEntry.date !== targetDate,
      memoChanged: dbEntry.memo !== targetMemo,
      linesAlreadyCorrect: linesMatch(dbEntry.lines, resolvedLines),
    });
  }

  if (problems.length) {
    console.log(`⚠️ مشاكل تمنع تصحيح بعض القيود (لن تُلمَس هذه القيود إطلاقاً):`);
    problems.forEach((p) => console.log(`  - ${p}`));
    console.log();
  }

  const closingDate = company.fiscalYearClosingDate;
  const closedEntries = prepared.filter((p) => closingDate && new Date(`${p.targetDate}T00:00:00.000Z`).getTime() <= closingDate.getTime());
  if (closedEntries.length) {
    console.log(`🛑 ${closedEntries.length} قيداً بتاريخ يقع في أو قبل تاريخ إقفال السنة المالية (${closingDate!.toISOString().slice(0, 10)}) — لن يُلمَس أي منها:`);
    closedEntries.forEach((p) => console.log(`  القيد ${p.originalNumber} بتاريخ ${p.targetDate}`));
    console.log();
  }
  const toProcess = prepared.filter((p) => !closedEntries.includes(p));

  const alreadyCorrect = toProcess.filter((p) => p.linesAlreadyCorrect && !p.dateChanged && !p.memoChanged);
  const needsFix = toProcess.filter((p) => !alreadyCorrect.includes(p));

  if (alreadyCorrect.length) {
    console.log(`✅ ${alreadyCorrect.length} قيداً صحيح بالفعل (لا حاجة لأي تعديل):`);
    alreadyCorrect.forEach((p) => console.log(`  القيد ${p.originalNumber}`));
    console.log();
  }

  console.log(`=== ${commit ? "سيُنفَّذ الآن" : "Dry-run — تفصيل ما سيُصحَّح"}: ${needsFix.length} قيداً ===\n`);
  for (const fix of needsFix) {
    console.log(`--- القيد الأصلي رقم ${fix.originalNumber} ---`);
    if (fix.dateChanged) console.log(`  التاريخ: ${fix.currentDate} -> ${fix.targetDate}`);
    else console.log(`  التاريخ: ${fix.targetDate} (بلا تغيير)`);
    if (fix.memoChanged) console.log(`  الـmemo: "${fix.currentMemo}" -> "${fix.targetMemo}"`);
    else console.log(`  الـmemo: "${fix.targetMemo}" (بلا تغيير)`);

    if (!fix.linesAlreadyCorrect) {
      console.log(`  الأسطر الحالية (ستُحذَف، ${fix.currentLines.length} سطراً):`);
      fix.currentLines.forEach((l) => console.log(`    ${l.accountName} | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)}`));
      console.log(`  الأسطر الصحيحة (ستُكتَب، ${fix.resolvedLines.length} سطراً):`);
      fix.resolvedLines.forEach((l) => console.log(`    ${l.accountName} | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)}`));
    } else {
      console.log(`  الأسطر: بلا تغيير (مطابقة للمرجع بالفعل)`);
    }
    const totalDebit = fix.resolvedLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = fix.resolvedLines.reduce((s, l) => s + l.credit, 0);
    console.log(`  التوازن: مدين=${totalDebit.toFixed(2)} = دائن=${totalCredit.toFixed(2)} ✅`);
    console.log();
  }

  if (!commit) {
    console.log(`(وضع Dry-run — لم يُكتَب أي شيء. أعد التشغيل بإضافة --commit للتنفيذ الفعلي بعد المراجعة والموافقة الصريحة.)`);
    return;
  }

  if (needsFix.length === 0) {
    console.log(`لا شيء يحتاج تصحيحاً — كل القيود القابلة للمعالجة صحيحة بالفعل.`);
    return;
  }

  console.log(`--commit مفعَّل: تصحيح ${needsFix.length} قيداً فعلياً الآن، كل قيد في معاملة مستقلة...`);
  let succeeded = 0;
  const failed: { originalNumber: number; error: string }[] = [];
  for (const fix of needsFix) {
    try {
      await prisma.$transaction(async (tx) => {
        if (!fix.linesAlreadyCorrect) {
          await tx.journalEntryLine.deleteMany({ where: { journalEntryId: fix.dbEntryId } });
          await tx.journalEntryLine.createMany({
            data: fix.resolvedLines.map((l) => ({
              id: randomUUID(),
              journalEntryId: fix.dbEntryId,
              accountId: l.accountId,
              debit: new Prisma.Decimal(l.debit),
              credit: new Prisma.Decimal(l.credit),
            })),
          });
        }
        await tx.journalEntry.update({
          where: { id: fix.dbEntryId },
          data: {
            date: fix.dateChanged ? new Date(`${fix.targetDate}T00:00:00.000Z`) : undefined,
            memo: fix.memoChanged ? fix.targetMemo : undefined,
          },
        });
      });
      succeeded++;
      console.log(`  ✅ القيد ${fix.originalNumber} صُحِّح بنجاح.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ originalNumber: fix.originalNumber, error: message });
      console.log(`  ❌ القيد ${fix.originalNumber} فشل: ${message}`);
    }
  }

  console.log(`\nتم بنجاح: ${succeeded} قيداً من ${needsFix.length}.`);
  if (failed.length) {
    console.log(`⚠️ فشل ${failed.length} قيداً — أعد تشغيل نفس الأمر لإعادة محاولتها فقط (القيود الناجحة الأخرى لن تتأثر):`);
    failed.forEach((f) => console.log(`  القيد ${f.originalNumber}: ${f.error}`));
  }
  console.log(`\nأعد تشغيل هذا الأمر (بأي وضع) للتأكد من idempotency — يجب أن يُظهر أن كل هذه القيود "صحيح بالفعل" الآن.`);
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const companyId = args.find((a) => !a.startsWith("--")) || DEFAULT_ARMI_COMPANY_ID;
  await run(companyId, commit);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

export { linesMatch, amountKey };
