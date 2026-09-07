/**
 * سكريبت تحقّق قرائي بحت (بلا أي كتابة) — يكتشف الاسم/الكود الفعلي في شجرة حسابات أثر المقابل
 * لاسم حساب معيّن في قيود، بالاستدلال من القيود الرقمية **المستوردة فعلياً وبنجاح من قبل**
 * (باستثناء الإحدى عشرة المعروفة بمشاكل: 401, 405, 496, 540, 600, 612, 627, 688, 724, 733, 1333،
 * التي تُستبعَد كلياً هنا لأن محتواها غير موثوق لهذا الغرض).
 *
 * لماذا هذا الأسلوب: create-armi-missing-entries.ts يعتمد مطابقة نصية دقيقة حرفية بين اسم الحساب
 * في قيود واسم الحساب في أثر، ورفض إنشاء أي قيد يستخدم اسماً غير مطابق تماماً (بدل التخمين). ظهرت
 * 3 أسماء غير مطابقة ("المدينون"، "ضريبة القيمة المضافة المستحقة"، "النقدية في الخزينة") — بدل
 * افتراض اسمها الصحيح يدوياً، هذا السكريبت يجد الحساب الفعلي المُستخدَم بالفعل في قيود مستوردة
 * سابقاً تستخدم نفس اسم الحساب في قيود لنفس المفهوم، عبر مطابقة كل سطر في قيود بسطر مطابق تماماً
 * بالقيمة (مدين/دائن) داخل القيد المقابل في أثر.
 *
 * لا يفترض تطابقاً واحداً بالضرورة — لو تبيَّن أن نفس اسم قيود يُستخدَم لحسابين مختلفين حسب كون
 * السطر مديناً أو دائناً (كما حدث فعلياً سابقاً مع "ضريبة القيمة المضافة المستحقة" التي انقسمت إلى
 * حسابين مختلفين)، يُبلَّغ ذلك صراحة بدل اختيار واحد عشوائياً.
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/discover-armi-account-mapping.ts "اسم1" "اسم2" ... [--list-accounts]
 *
 * --list-accounts اختياري: يطبع في النهاية شجرة حسابات الترحيل الكاملة للشركة (كود + اسم) للمراجعة
 * اليدوية المباشرة عندما تكون العيّنة الآلية ضعيفة جداً (مثال متوقَّع هنا: "المدينون" له استخدام
 * موثوق واحد فقط بين القيود الرقمية غير المستبعَدة).
 */
import { PrismaClient } from "@prisma/client";
import { loadExcelLines, groupExcelEntries } from "./investigate-armi-full-reconciliation";
import { KNOWN_EXTRA_LINE_ENTRY_NUMBERS } from "./verify-armi-extra-lines-hypothesis";

const prisma = new PrismaClient();
const ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const MEMO_ENTRY_NUMBER_RE = /قيد يدوي رقم\s*(\d+)/;

function amountKey(debit: number, credit: number): string {
  return `${Math.round(debit * 100)}|${Math.round(credit * 100)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const listAccounts = args.includes("--list-accounts");
  const targetNames = args.filter((a) => !a.startsWith("--"));
  if (targetNames.length === 0 && !listAccounts) {
    console.error('مرّر اسماً واحداً على الأقل بين علامتي اقتباس، مثال: npx tsx scripts/discover-armi-account-mapping.ts "المدينون"');
    process.exitCode = 1;
    return;
  }

  const excelLines = loadExcelLines();
  const excelEntries = groupExcelEntries(excelLines);
  const excludedNumbers = new Set(KNOWN_EXTRA_LINE_ENTRY_NUMBERS);

  // كل القيود الرقمية الموثوقة (تُستبعَد الإحدى عشرة المعروفة بمشاكل) مع رقمها الأصلي كمفتاح
  const numericEntries = [...excelEntries.values()].filter((e) => e.pattern === "NUMERIC" && !excludedNumbers.has(Number(e.reference)));

  const dbEntries = await prisma.journalEntry.findMany({
    where: { companyId: ARMI_COMPANY_ID, sourceModule: "bulk_import" },
    include: { lines: { include: { account: true } } },
  });
  const dbByOriginalNumber = new Map<number, (typeof dbEntries)[number]>();
  for (const entry of dbEntries) {
    const m = entry.memo ? MEMO_ENTRY_NUMBER_RE.exec(entry.memo) : null;
    if (!m) continue;
    dbByOriginalNumber.set(Number(m[1]), entry);
  }

  for (const targetName of targetNames) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`اسم الحساب في قيود: "${targetName}"`);
    console.log("=".repeat(60));

    const tallyDebitSide = new Map<string, number>(); // للأسطر المدينة في قيود
    const tallyCreditSide = new Map<string, number>(); // للأسطر الدائنة في قيود
    let occurrences = 0;
    let matchedOccurrences = 0;
    const unmatchedSamples: { entryNumber: string; debit: number; credit: number }[] = [];

    for (const excelEntry of numericEntries) {
      const matchingLines = excelEntry.lines.filter((l) => l.account.trim() === targetName.trim());
      if (matchingLines.length === 0) continue;

      const dbEntry = dbByOriginalNumber.get(Number(excelEntry.reference));
      if (!dbEntry) continue;

      // لتفادي تلوّث النتيجة بقيود لها مشاكل عدد أسطر غير معروفة (خارج القائمة الإحدى عشرة
      // المعروفة)، نتجاهل أي قيد لا يتطابق عدد أسطره تماماً بين قيود وأثر لهذا القيد تحديداً.
      if (dbEntry.lines.length !== excelEntry.lines.length) continue;

      const dbLinesByKey = new Map<string, typeof dbEntry.lines>();
      for (const l of dbEntry.lines) {
        const k = amountKey(Number(l.debit), Number(l.credit));
        dbLinesByKey.set(k, [...(dbLinesByKey.get(k) || []), l]);
      }

      for (const excelLine of matchingLines) {
        occurrences++;
        const k = amountKey(excelLine.debit, excelLine.credit);
        const candidates = dbLinesByKey.get(k);
        if (!candidates || candidates.length === 0) {
          unmatchedSamples.push({ entryNumber: dbEntry.entryNumber, debit: excelLine.debit, credit: excelLine.credit });
          continue;
        }
        matchedOccurrences++;
        // لو أكثر من سطر بنفس القيمة (تعادل)، نُحصي كل المرشّحين معاً — التجميع الإحصائي لاحقاً
        // سيُظهر أيّاً منهم الأكثر تكراراً بثقة عبر عشرات القيود، لا قيد واحد فقط.
        for (const dbLine of candidates) {
          const label = `${dbLine.account?.name} [${dbLine.account?.code}]`;
          const tally = excelLine.debit !== 0 ? tallyDebitSide : tallyCreditSide;
          tally.set(label, (tally.get(label) || 0) + 1);
        }
      }
    }

    console.log(`عدد الأسطر في قيود (قيود رقمية موثوقة فقط) تستخدم هذا الاسم: ${occurrences}`);
    console.log(`منها أمكن مطابقتها بسطر في أثر بنفس القيمة: ${matchedOccurrences}`);
    if (unmatchedSamples.length) {
      console.log(`⚠️ ${unmatchedSamples.length} سطراً لم يُطابَق (عيّنة):`);
      unmatchedSamples.slice(0, 5).forEach((s) => console.log(`    entryNumber=${s.entryNumber} مدين=${s.debit.toFixed(2)} دائن=${s.credit.toFixed(2)}`));
    }

    if (tallyDebitSide.size) {
      console.log(`\nالحساب الفعلي المستخدَم في أثر — للأسطر المدينة في قيود:`);
      [...tallyDebitSide.entries()].sort((a, b) => b[1] - a[1]).forEach(([label, count]) => console.log(`    ${label}: ${count} مرة`));
    }
    if (tallyCreditSide.size) {
      console.log(`\nالحساب الفعلي المستخدَم في أثر — للأسطر الدائنة في قيود:`);
      [...tallyCreditSide.entries()].sort((a, b) => b[1] - a[1]).forEach(([label, count]) => console.log(`    ${label}: ${count} مرة`));
    }
    if (!tallyDebitSide.size && !tallyCreditSide.size) {
      console.log(`\n❌ لم يُعثَر على أي استخدام موثوق لهذا الاسم في القيود الرقمية غير المستبعَدة — لا يمكن الاستدلال آلياً، يحتاج بحثاً يدوياً مباشراً في شجرة الحسابات.`);
    } else if (matchedOccurrences < 3) {
      console.log(`\n⚠️ عيّنة صغيرة جداً (${matchedOccurrences} مطابقة فقط) — النتيجة أعلاه مؤشِّر، لا تأكيد إحصائي قوي. راجع شجرة الحسابات مباشرة للتأكد قبل اعتمادها.`);
    }
  }

  if (listAccounts) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`القائمة الكاملة لحسابات الترحيل في شجرة حسابات الشركة (للمراجعة اليدوية عند ضعف الاستدلال الآلي)`);
    console.log("=".repeat(60));
    const company = await prisma.company.findUnique({ where: { id: ARMI_COMPANY_ID }, select: { tenantId: true } });
    const accounts = await prisma.account.findMany({
      where: { tenantId: company?.tenantId, companyId: ARMI_COMPANY_ID, isPosting: true, isArchived: false, isActive: true },
      select: { code: true, name: true },
      orderBy: { code: "asc" },
    });
    accounts.forEach((a) => console.log(`  ${a.code}  ${a.name}`));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
