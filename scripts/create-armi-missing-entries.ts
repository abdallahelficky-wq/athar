/**
 * سكريبت إنشاء القيود الغائبة تماماً من أثر لشركة أرمي (bulk_import) — Dry-run افتراضياً،
 * --commit للتنفيذ الفعلي. عميل Prisma مستقل تماماً (بلا اعتماد على src/lib/prisma.ts، وبالتبعية
 * بلا اعتماد على src/config/env.ts) — نفس أسلوب كل سكريبتات أرمي السابقة في هذا المشروع.
 *
 * يتعامل **حصراً** مع القيود ذات المرجع غير الرقمي (نمط PYT أو INV) المؤكَّد غيابها تماماً من أثر —
 * حالياً PYT1-PYT12 وINV1-INV8 (20 قيداً)، حسب تقرير investigate-armi-full-reconciliation.ts. **لا
 * يلمس أي قيد بمرجع رقمي إطلاقاً بأي شكل** (لا قراءة قيمه للمقارنة، ولا كتابة) — القيود الإحدى عشرة
 * المعروفة (401, 405, 496, 540, 600, 612, 627, 688, 724, 733, 1333) خارج نطاق هذا السكريبت كلياً،
 * بانتظار مراجعة يدوية فردية منفصلة تماماً عنه.
 *
 * لكل قيد مستهدَف:
 *   1. يبني أسطره من reference/armi_statement_*.csv (نفس مصدر الحقيقة المستخدَم في كل تحقيقات أرمي).
 *   2. يرفض إنشاءه إن كانت أسطره موزَّعة على أكثر من تاريخ واحد (قيد واحد = تاريخ واحد في المخطط).
 *   3. يتحقق من توازن مدين/دائن للقيد نفسه (لا الإجمالي الكلي فقط).
 *   4. يربط كل اسم حساب باسمه الفعلي في شجرة حسابات الشركة بمطابقة نصية دقيقة تماماً فقط (لا تخمين
 *      ولا مطابقة جزئية) — يتوقف صراحة عن إنشاء أي قيد يستخدم اسم حساب غير موجود أو غامض (أكثر من
 *      حساب بنفس الاسم)، بدل الربط الخاطئ الصامت. الاستثناء الوحيد: ACCOUNT_NAME_TO_CODE_OVERRIDES
 *      أدناه — 3 أسماء أُقِرَّت يدوياً بعد استدلال رقمي من القيود الموثوقة (discover-armi-account-
 *      mapping.ts)، تُطابَق بالكود الصريح بدل الاسم.
 *   5. يتحقق أن تاريخه لا يقع في أو قبل تاريخ إقفال السنة المالية المضبوط لهذه الشركة (إن وُجد).
 *   6. Idempotency: يبحث أولاً عن أي قيد bulk_import موجود بنفس نص الـmemo المستهدَف بالضبط — إن
 *      وُجد يُتخطَّى بصمت (لا إنشاء مكرَّر). إعادة تشغيل هذا الأمر بعد نجاح --commit آمنة تماماً
 *      وتُظهر "لا شيء يحتاج إنشاءً".
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/create-armi-missing-entries.ts [companyId] [--commit]
 *
 * companyId اختياري (افتراضياً معرّف أرمي الحقيقي) — للاختبار المحلي على شركة تجريبية قبل التشغيل
 * الفعلي على الإنتاج.
 */
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadExcelLines, groupExcelEntries, type ExcelEntry } from "./investigate-armi-full-reconciliation";

const prisma = new PrismaClient();
const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const BALANCE_EPSILON = 0.01;

// خريطة تحويل صريحة لأسماء حسابات قيود التي لا تطابق اسمها الفعلي في أثر حرفياً — اكتُشفت
// بالاستدلال الرقمي من القيود الرقمية الموثوقة المستوردة فعلياً (scripts/discover-armi-account-
// mapping.ts) وأُقِرَّت صراحةً بعد المراجعة. تُطابَق بالكود (أدق من الاسم، ويتفادى أي انحراف طفيف
// لاحق في تسمية الحساب) بدل الاسم لهذه الثلاثة تحديداً فقط — كل اسم آخر يبقى على المطابقة النصية
// الدقيقة الافتراضية بلا أي استثناء.
export const ACCOUNT_NAME_TO_CODE_OVERRIDES: Record<string, string> = {
  "المدينون": "112001", // عملاء - مبيعات جملة/عقود — عيّنة استدلال صغيرة (مطابقة واحدة)، أُقِرَّت يدوياً بعد مراجعة السياق (معاملات "Customer Cash")
  "ضريبة القيمة المضافة المستحقة": "213001", // ضريبة القيمة المضافة المستحقة (مبيعات) — كل الأسطر هنا دائنة فقط (لا مدينة)، فلا حاجة لتفرقة جانب المدين/الدائن كما في الاستيراد الأصلي
  "النقدية في الخزينة": "111001", // الصندوق النقدي - الإدارة العامة
};

function buildMemo(entry: ExcelEntry): string {
  if (entry.pattern === "PYT") return `سند قبض رقم ${entry.reference} - مستورد من قيود`;
  if (entry.pattern === "INV") return `فاتورة مبيعات رقم ${entry.reference} - مستورد من قيود`;
  throw new Error(`نمط غير متوقَّع لبناء القيود الجديدة (يجب أن يكون PYT أو INV فقط): ${entry.pattern} (${entry.reference})`);
}

export interface PreparedEntry {
  reference: string;
  pattern: string;
  date: string;
  memo: string;
  totalDebit: number;
  totalCredit: number;
  lines: { accountName: string; debit: number; credit: number; description: string }[];
}

// منطق خالص (بلا أي قراءة ملفات/DB) — يُعاد استخدامه حرفياً في اختبار محلي بالكامل قبل أي اقتراب
// من الإنتاج. يُعالج فقط أنماط PYT/INV — أي قيد آخر (رقمي أو غيره) يُتجاهَل تماماً هنا أصلاً.
export function prepareEntries(excelEntries: Map<string, ExcelEntry>): { prepared: PreparedEntry[]; problems: string[] } {
  const targets = [...excelEntries.values()]
    .filter((e) => e.pattern === "PYT" || e.pattern === "INV")
    .sort((a, b) => a.reference.localeCompare(b.reference, undefined, { numeric: true }));

  const prepared: PreparedEntry[] = [];
  const problems: string[] = [];

  for (const entry of targets) {
    if (entry.dates.size !== 1) {
      problems.push(`القيد "${entry.reference}": أسطره موزَّعة على أكثر من تاريخ (${[...entry.dates].join(", ")}) — لا يمكن إنشاء قيد واحد بتاريخ واحد، يحتاج مراجعة يدوية.`);
      continue;
    }
    const diff = entry.totalDebit - entry.totalCredit;
    if (Math.abs(diff) > BALANCE_EPSILON) {
      problems.push(`القيد "${entry.reference}": غير متوازن (مدين=${entry.totalDebit.toFixed(2)}, دائن=${entry.totalCredit.toFixed(2)}) — لن يُنشأ.`);
      continue;
    }
    prepared.push({
      reference: entry.reference,
      pattern: entry.pattern,
      date: [...entry.dates][0],
      memo: buildMemo(entry),
      totalDebit: entry.totalDebit,
      totalCredit: entry.totalCredit,
      lines: entry.lines.map((l) => ({ accountName: l.account, debit: l.debit, credit: l.credit, description: l.description })),
    });
  }
  return { prepared, problems };
}

// المنطق الكامل (بعد تحليل argv) — مُصدَّر ليُستدعى مباشرة من اختبار تكامل محلي على شركة تجريبية
// (بلا المرور عبر CLI)، وأيضاً من main() الفعلي أدناه.
export async function run(companyId: string, commit: boolean) {
  console.log(`=== إنشاء القيود الغائبة (PYT/INV فقط — لا رقمية إطلاقاً) — companyId=${companyId} ${commit ? "(--commit: سيُنفَّذ فعلياً)" : "(Dry-run، بلا أي كتابة)"} ===\n`);

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, tenantId: true, numberingPrefix: true, fiscalYearClosingDate: true },
  });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);

  const excelLines = loadExcelLines();
  const excelEntries = groupExcelEntries(excelLines);
  const { prepared, problems } = prepareEntries(excelEntries);

  console.log(`قيود PYT/INV المستهدَفة إجمالاً: ${prepared.length + problems.length} (${prepared.length} صالحة للمعالجة، ${problems.length} بها مشاكل تمنع الإنشاء)`);
  if (problems.length) {
    console.log(`\n⚠️ مشاكل تمنع إنشاء بعض القيود (لن تُلمَس هذه القيود إطلاقاً، لا هنا ولا يدوياً عبر هذا السكريبت):`);
    problems.forEach((p) => console.log(`  - ${p}`));
  }

  const closingDate = company.fiscalYearClosingDate;
  const closedEntries = prepared.filter((p) => closingDate && new Date(`${p.date}T00:00:00.000Z`).getTime() <= closingDate.getTime());
  if (closedEntries.length) {
    console.log(`\n🛑 ${closedEntries.length} قيداً بتاريخ يقع في أو قبل تاريخ إقفال السنة المالية (${closingDate!.toISOString().slice(0, 10)}) — يُوقَف تماماً، لا إنشاء لأي قيد حتى تُراجَع هذه الحالة يدوياً:`);
    closedEntries.forEach((p) => console.log(`  "${p.reference}" بتاريخ ${p.date}`));
    return;
  }

  const targetMemos = prepared.map((p) => p.memo);
  const existing = await prisma.journalEntry.findMany({
    where: { companyId, sourceModule: "bulk_import", memo: { in: targetMemos } },
    select: { memo: true, entryNumber: true },
  });
  const existingMemos = new Set(existing.map((e) => e.memo));
  const toCreate = prepared.filter((p) => !existingMemos.has(p.memo));
  const alreadyExists = prepared.filter((p) => existingMemos.has(p.memo));

  if (alreadyExists.length) {
    console.log(`\n✅ ${alreadyExists.length} قيداً موجود بالفعل (أُنشئ في تشغيلة سابقة لهذا السكريبت) — سيُتخطَّى بصمت:`);
    alreadyExists.forEach((p) => {
      const match = existing.find((e) => e.memo === p.memo);
      console.log(`  "${p.reference}" -> entryNumber=${match?.entryNumber}`);
    });
  }

  if (toCreate.length === 0) {
    console.log(`\n✅ لا شيء يحتاج إنشاءً — كل القيود المستهدَفة الصالحة موجودة بالفعل.`);
    return;
  }

  const distinctAccountNames = [...new Set(toCreate.flatMap((p) => p.lines.map((l) => l.accountName)))];
  const accounts = await prisma.account.findMany({
    where: { tenantId: company.tenantId, companyId, isPosting: true, isArchived: false, isActive: true },
    select: { id: true, code: true, name: true },
  });
  const byName = new Map<string, typeof accounts>();
  const byCode = new Map<string, (typeof accounts)[number]>();
  for (const a of accounts) {
    const key = a.name.trim();
    byName.set(key, [...(byName.get(key) || []), a]);
    byCode.set(a.code, a);
  }

  const accountMapping = new Map<string, string>();
  const accountProblems: string[] = [];
  for (const name of distinctAccountNames) {
    const overrideCode = ACCOUNT_NAME_TO_CODE_OVERRIDES[name.trim()];
    if (overrideCode) {
      const account = byCode.get(overrideCode);
      if (account) {
        accountMapping.set(name, account.id);
        console.log(`  (خريطة تحويل صريحة) "${name}" -> "${account.name}" [${account.code}]`);
      } else {
        accountProblems.push(`الحساب "${name}" له خريطة تحويل صريحة إلى الكود ${overrideCode}، لكن لا يوجد حساب ترحيل نشط بهذا الكود في شجرة حسابات الشركة حالياً — راجع الخريطة.`);
      }
      continue;
    }
    const candidates = byName.get(name.trim()) || [];
    if (candidates.length === 1) {
      accountMapping.set(name, candidates[0].id);
    } else if (candidates.length === 0) {
      accountProblems.push(`الحساب "${name}" غير موجود في شجرة حسابات الشركة (مطابقة نصية دقيقة) — لا يمكن إنشاء أي قيد يستخدمه.`);
    } else {
      accountProblems.push(`الحساب "${name}" غامض (${candidates.length} حسابات بنفس الاسم: ${candidates.map((c) => c.code).join(", ")}) — لا يمكن الربط تلقائياً بثقة.`);
    }
  }

  if (accountProblems.length) {
    console.log(`\n🛑 مشاكل في مطابقة الحسابات — لن يُنشأ أي قيد حتى تُحل يدوياً:`);
    accountProblems.forEach((p) => console.log(`  - ${p}`));
    return;
  }

  console.log(`\n=== ${commit ? "سيُنفَّذ الآن" : "Dry-run — تفصيل ما سيُنشأ"}: ${toCreate.length} قيداً جديداً ===\n`);
  let grandDebit = 0;
  let grandCredit = 0;
  for (const p of toCreate) {
    console.log(`--- "${p.reference}" (${p.pattern}) | التاريخ: ${p.date} | الـmemo: "${p.memo}" ---`);
    p.lines.forEach((l) => {
      const accountId = accountMapping.get(l.accountName)!;
      console.log(`    ${l.accountName} [${accountId}] | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)} | ${l.description}`);
    });
    console.log(`    التوازن: مدين=${p.totalDebit.toFixed(2)} = دائن=${p.totalCredit.toFixed(2)} ✅`);
    grandDebit += p.totalDebit;
    grandCredit += p.totalCredit;
  }
  console.log(`\nالإجمالي: ${toCreate.length} قيداً | مدين=${grandDebit.toFixed(2)} | دائن=${grandCredit.toFixed(2)}`);

  if (!commit) {
    console.log(`\n(وضع Dry-run — لم يُكتَب أي شيء. أعد التشغيل بإضافة --commit للتنفيذ الفعلي بعد المراجعة والموافقة الصريحة.)`);
    return;
  }

  console.log(`\n--commit مفعَّل: إنشاء ${toCreate.length} قيداً فعلياً الآن، كمعاملة واحدة ذرّية...`);

  const result = await prisma.$transaction(
    async (tx) => {
      const reserved = await tx.$queryRaw<{ startSeq: number; numberingPrefix: string; fiscalYearClosingDate: Date | null }[]>`
        UPDATE "companies" SET "nextJournalEntrySeq" = "nextJournalEntrySeq" + ${toCreate.length}
        WHERE "id" = ${companyId}
        RETURNING ("nextJournalEntrySeq" - ${toCreate.length})::int AS "startSeq", "numberingPrefix", "fiscalYearClosingDate"
      `;
      const startSeq = reserved[0]?.startSeq;
      const prefix = reserved[0]?.numberingPrefix;
      if (startSeq == null || !prefix) throw new Error("تعذّر حجز أرقام تسلسلية — الشركة غير موجودة؟");

      // إعادة فحص إقفال السنة المالية بالقيمة المقفولة ذرّياً الآن (سباق نادر بين الفحص المبكر أعلاه
      // وبدء هذه المعاملة تحديداً) — بنفس أسلوب bulkImport.service.ts.
      const raceClosingDate = reserved[0].fiscalYearClosingDate;
      const raceClosed = toCreate.filter((p) => raceClosingDate && new Date(`${p.date}T00:00:00.000Z`).getTime() <= raceClosingDate.getTime());
      if (raceClosed.length) {
        throw new Error(`تم ضبط إقفال سنة مالية يشمل ${raceClosed.length} من القيود المطلوب إنشاؤها أثناء إتمام هذه العملية تحديداً — أعد المحاولة بعد المراجعة.`);
      }

      const entryRows: Prisma.JournalEntryCreateManyInput[] = [];
      const lineRows: Prisma.JournalEntryLineCreateManyInput[] = [];

      toCreate.forEach((p, index) => {
        const entryId = randomUUID();
        const entryNumber = `${prefix}${String(startSeq + index).padStart(5, "0")}`;
        entryRows.push({
          id: entryId,
          tenantId: company.tenantId,
          companyId,
          date: new Date(`${p.date}T00:00:00.000Z`),
          memo: p.memo,
          status: "saved",
          entryNumber,
          sourceModule: "bulk_import",
        });
        for (const l of p.lines) {
          lineRows.push({
            id: randomUUID(),
            journalEntryId: entryId,
            accountId: accountMapping.get(l.accountName)!,
            description: l.description || null,
            debit: new Prisma.Decimal(l.debit || 0),
            credit: new Prisma.Decimal(l.credit || 0),
          });
        }
      });

      await tx.journalEntry.createMany({ data: entryRows });
      await tx.journalEntryLine.createMany({ data: lineRows });
      return { createdEntries: entryRows.length, createdLines: lineRows.length };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  console.log(`\n✅ تم إنشاء ${result.createdEntries} قيداً (${result.createdLines} سطراً) بنجاح.`);
  console.log(`أعد تشغيل هذا الأمر (بأي وضع) للتأكد من idempotency — يجب أن يُظهر "لا شيء يحتاج إنشاءً" لكل هذه المراجع الآن.`);
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
