/**
 * سكريبت قرائي فقط بالكامل — لا يُعدِّل ولا يحذف ولا يُنشئ أي شيء في قاعدة البيانات.
 *
 * الغرض: قبل أي --commit فعلي على fix-armi-entries-688-724-733-1333.ts، التحقق من أن الحركات
 * "الأجنبية" التي سيحذفها ذلك السكريبت من القيدين 733 (J00723) و1333 (J01311) موجودة بالفعل في
 * أثر نفسه كقيود مستقلة خاصة بها (لا داخل 733/1333 فقط) — أي أنها مسجَّلة فعلياً في مكان آخر من
 * دفتر الأستاذ، فحذفها من 733/1333 لن يُفقِد أي بيانات محاسبية فعلية من أثر، فقط يزيل تكراراً.
 * (الاستقصاء السابق في fix-armi-entries-688-724-733-1333.ts أثبت وجودها في ملفات قيود المرجعية
 * الخام؛ هذا السكريبت يتحقق من الخطوة المكمِّلة: هل استُوردت هذه الحركات بالفعل إلى أثر كقيود
 * مستقلة أم لا.)
 *
 * الحركات الأربع المفحوصة (بمطابقة اسم الحساب + المبلغ + الاتجاه ضمن نفس القيد، بسماحية تقريب
 * صغيرة لأن قيود يسجّل أحياناً كسور هللات كما وُثِّق سابقاً):
 *   1) فاتورة مبيعات سكراب: عملاء-مبيعات جملة/عقود مدين 25,000 + ضريبة القيمة المضافة المستحقة
 *      (مبيعات) دائن 3,261 + الايرادات من بيع السكراب دائن 21,739 — كلها ضمن قيد واحد.
 *   2) فاتورة مبيعات قطع غيار: عملاء-مبيعات جملة/عقود مدين 1,000 + ضريبة القيمة المضافة المستحقة
 *      (مبيعات) دائن 65 + إيرادات قطع الغيار دائن 435 — كلها ضمن قيد واحد.
 *   3) سند قبض بنك الراجحي: بنك الراجحي مدين 25,000 مقابل عملاء دائن 25,000 — ضمن قيد واحد.
 *   4) سند قبض بنك الأهلي: حساب البنك الأهلي 12300001016808 مدين 500 مقابل عملاء دائن 500 — ضمن
 *      قيد واحد.
 *
 * يُستبعَد القيدان J00723 وJ01311 أنفسهما من البحث (وجود هذه الحركات فيهما هو المشكلة الأصلية
 * المعروفة، لا الشيء المطلوب التحقق منه). يُطبَع لكل حركة: القيد الذي وُجدت فيه (رقمه وتاريخه
 * وبيانه) أو "غير موجودة"، ثم تلخيص صريح: هل أيٌّ منها موجود ضمن نطاق J01817-J01836 تحديداً
 * (القيود العشرون التي أنشأها create-armi-missing-entries.ts سابقاً)؟
 *
 * الاستخدام: DATABASE_URL=<...> npx tsx scripts/check-armi-inv-pyt-presence.ts [companyId]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const EXCLUDED_ENTRY_NUMBERS = ["J00723", "J01311"];
// سماحية تقريب أوسع من المعتاد — الاستقصاء السابق في fix-armi-entries-688-724-733-1333.ts وثّق
// فروق هللات فعلية في المرجع نفسه (مثال: 25,000 المسجَّلة فعلياً 25,000.05).
const EPSILON = 1;
const RANGE_START = 1817;
const RANGE_END = 1836;
const RANGE_LABEL = `J${String(RANGE_START).padStart(5, "0")}-J${String(RANGE_END).padStart(5, "0")}`;

interface LineCriterion {
  account: string;
  amount: number;
  direction: "debit" | "credit";
}

interface MovementGroup {
  label: string;
  criteria: LineCriterion[];
}

const GROUPS: MovementGroup[] = [
  {
    label: "فاتورة مبيعات سكراب (عملاء 25,000 مدين / ضريبة القيمة المضافة المستحقة-مبيعات 3,261 دائن / الايرادات من بيع السكراب 21,739 دائن)",
    criteria: [
      { account: "عملاء - مبيعات جملة/عقود", amount: 25000, direction: "debit" },
      { account: "ضريبة القيمة المضافة المستحقة (مبيعات)", amount: 3261, direction: "credit" },
      { account: "الايرادات من بيع السكراب", amount: 21739, direction: "credit" },
    ],
  },
  {
    label: "فاتورة مبيعات قطع غيار (عملاء 1,000 مدين / ضريبة القيمة المضافة المستحقة-مبيعات 65 دائن / إيرادات قطع الغيار 435 دائن)",
    criteria: [
      { account: "عملاء - مبيعات جملة/عقود", amount: 1000, direction: "debit" },
      { account: "ضريبة القيمة المضافة المستحقة (مبيعات)", amount: 65, direction: "credit" },
      { account: "إيرادات قطع الغيار", amount: 435, direction: "credit" },
    ],
  },
  {
    label: "سند قبض بنك الراجحي (بنك الراجحي 25,000 مدين مقابل عملاء 25,000 دائن)",
    criteria: [
      { account: "بنك الراجحي", amount: 25000, direction: "debit" },
      { account: "عملاء - مبيعات جملة/عقود", amount: 25000, direction: "credit" },
    ],
  },
  {
    // الاسم الفعلي الدقيق لهذا الحساب في شجرة حسابات أثر هو "حساب البنك الاهلي 12300001016808"
    // (بالضبط كما يظهر في ملفات قيود المرجعية) لا "بنك الأهلي 12300001016808" — اكتُشف هذا لاحقاً
    // بمراجعة create-armi-missing-entries.ts: أنشأ ذلك السكريبت فعلاً 20 قيداً تستخدم هذا الاسم
    // حرفياً (منها PYT1/PYT5/PYT8/PYT9) دون أي حاجة لخريطة تحويل صريحة له في
    // ACCOUNT_NAME_TO_CODE_OVERRIDES، ما يثبت أن هذا هو الاسم الحقيقي المطابق تماماً في أثر.
    label: "سند قبض حساب البنك الاهلي 12300001016808 (500 مدين مقابل عملاء 500 دائن)",
    criteria: [
      { account: "حساب البنك الاهلي 12300001016808", amount: 500, direction: "debit" },
      { account: "عملاء - مبيعات جملة/عقود", amount: 500, direction: "credit" },
    ],
  },
];

function isInCreatedRange(entryNumber: string): boolean {
  const m = /^([A-Za-z]*)(\d+)$/.exec(entryNumber);
  if (!m) return false;
  const num = Number(m[2]);
  return num >= RANGE_START && num <= RANGE_END;
}

interface DbLine {
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

function entrySatisfiesCriteria(entry: DbEntry, criteria: LineCriterion[]): boolean {
  return criteria.every((c) =>
    entry.lines.some((l) => {
      if (l.accountName !== c.account) return false;
      const amt = c.direction === "debit" ? l.debit : l.credit;
      return Math.abs(amt - c.amount) < EPSILON;
    }),
  );
}

export async function run(companyId: string) {
  console.log(`=== التحقق من وجود حركات 733/1333 "الأجنبية" كقيود مستقلة في أثر — companyId=${companyId} (قرائي فقط، بلا أي تعديل) ===\n`);

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);

  const dbEntries = await prisma.journalEntry.findMany({
    where: { companyId, entryNumber: { notIn: EXCLUDED_ENTRY_NUMBERS } },
    include: { lines: { include: { account: true } } },
    orderBy: { entryNumber: "asc" },
  });

  const entries: DbEntry[] = dbEntries.map((e) => ({
    id: e.id,
    entryNumber: e.entryNumber,
    date: e.date.toISOString().slice(0, 10),
    memo: e.memo,
    lines: e.lines.map((l) => ({ accountName: l.account?.name || "", debit: Number(l.debit), credit: Number(l.credit) })),
  }));

  console.log(`إجمالي القيود المفحوصة (بعد استبعاد ${EXCLUDED_ENTRY_NUMBERS.join(" و")}): ${entries.length}\n`);

  const allMatches: { group: MovementGroup; entry: DbEntry }[] = [];

  for (const group of GROUPS) {
    console.log(`--- ${group.label} ---`);
    const matches = entries.filter((e) => entrySatisfiesCriteria(e, group.criteria));
    if (matches.length === 0) {
      console.log(`  ❓ غير موجودة كقيد مستقل في أثر إطلاقاً (خارج ${EXCLUDED_ENTRY_NUMBERS.join(" و")}).`);
    } else {
      matches.forEach((m) => {
        console.log(`  ✅ موجودة في القيد ${m.entryNumber} بتاريخ ${m.date} — البيان: "${m.memo}"`);
        allMatches.push({ group, entry: m });
      });
    }
    console.log();
  }

  console.log(`=== هل ضمن القيود ${RANGE_LABEL} (التي أنشأها create-armi-missing-entries.ts) توجد أي من هذه الحركات؟ ===`);
  const inRange = allMatches.filter((m) => isInCreatedRange(m.entry.entryNumber));
  if (inRange.length === 0) {
    console.log(`  لا — لا يوجد أي من الحركات الأربع ضمن نطاق ${RANGE_LABEL}.`);
  } else {
    console.log(`  نعم — ${inRange.length} حركة/حركات ضمن هذا النطاق:`);
    inRange.forEach((m) => console.log(`    ${m.group.label} → القيد ${m.entry.entryNumber} بتاريخ ${m.entry.date}`));
  }
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
