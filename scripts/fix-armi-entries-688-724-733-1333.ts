/**
 * سكريبت تصحيح للأربعة الباقية من الإحدى عشرة قيداً المعروفة سابقاً بمشاكل "أسطر زائدة"
 * (688, 724, 733, 1333) — الأربعة التي استُثنيت عمداً من fix-armi-seven-entries.ts.
 *
 * الفرق الجوهري عن fix-armi-seven-entries.ts: هناك لم تكن الأسطر الصحيحة موجودة أصلاً بشكل صحيح
 * (تحتاج حذف الكل وإعادة الكتابة من المرجع). هنا الزوج الصحيح من الأسطر موجود فعلاً بين الأسطر
 * الحالية، لكنه مكرَّر (×2 أو ×3) ومختلط بأسطر "أجنبية" (فاتورة مبيعات/سند قبض كاملين تسرَّبا لنفس
 * القيد). التصحيح هنا إذن: الإبقاء على نسخة واحدة فقط من الزوج الصحيح (بلا حذف/إعادة إنشاء لها —
 * تُبقى بنفس الـid)، وحذف كل ما عداها فقط.
 *
 * تحديد القيود الأربعة: بمطابقة نصية دقيقة (exact match) على حقل الـmemo، وليس برقم القيد
 * الأصلي المُستخرَج بتعبير نمطي كما في السكريبتات السابقة — لأن هذه الأربعة تحمل صيغة مختلفة
 * ("قيد يدوي رقم N - أنشئ بواسطة Kashif Ali"). يُقرأ الأربعة بالبيان الأصلي مرة واحدة في بداية
 * التشغيل وتُحفَظ معرّفاتها الداخلية (id) فوراً، لأن التصحيح نفسه سيغيّر البيان — أي بحث لاحق
 * بالبيان الأصلي بعد التصحيح لن يجد شيئاً (هذا بالضبط أساس اكتشاف idempotency أدناه).
 *
 * قاعدة صارمة عند التحديد: لو مطابقة البيان الأصلي رجّعت أكثر من نتيجة واحدة، أو صفر نتائج مع عدم
 * وجود القيد بحالته المصحَّحة أصلاً (بالرقم المتوقَّع + البيان/الأسطر المستهدَفة) — يتوقف تنفيذ
 * السكريبت **بالكامل فوراً** (لا معالجة جزئية لبقية الثلاثة)، ويُطبَع السبب بالتفصيل، ولا يُكتَب أي
 * شيء على أي قيد. هذا التشديد خاص بمرحلة التحديد فقط؛ مشاكل حسابات مفقودة/غامضة لاحقاً (نادرة، لم
 * تُكتشَف فعلياً في التحقيق) تُعزَل لقيدها فقط، بنفس نمط fix-armi-seven-entries.ts.
 *
 * Idempotency: لو القيد الرابع لم يُعثَر عليه بالبيان الأصلي، يُبحَث عنه بالرقم المتوقَّع
 * (J00610/J00711/J00723/J01311)؛ لو وُجد بحالته المستهدَفة كاملة بالفعل (نفس البيان + نفس الأسطر
 * تماماً) يُعتبَر "صحيح بالفعل" ويُتخطَّى بصمت — لا هذا خطأ ولا يوقف السكريبت.
 *
 * خطوة استقصاء إلزامية (معلوماتية بحتة، تُطبَع دائماً قبل أي شيء آخر ولا تمنع أي تصحيح): البحث في
 * ملفات قيود المرجعية الخمسة الكاملة عن أي سطر يطابق كل حركة "أجنبية" في القيدين 733/1333، بمطابقة
 * (اسم الحساب + المبلغ + الاتجاه) — لتوثيق أن هذه الحركات تخص فعلاً فواتير/سندات أخرى مذكورة كاملة
 * في المرجع، لا بيانات مفقودة يجب الإبقاء عليها هنا.
 *
 * قيود صارمة أخرى:
 *   - لا يُلمَس تاريخ أي قيد إطلاقاً — بند التاريخ خارج نطاق هذا السكريبت كلياً.
 *   - كل قيد يُعالَج في معاملة Prisma مستقلة تماماً (rollback تلقائي عند أي فشل جزئي داخلها)،
 *     بمعزل عن باقي القيود الثلاثة (فشل واحد لا يوقف تصحيح الباقي، إلا في مرحلة التحديد أعلاه).
 *   - كل تصحيح فعلي يُسجَّل في AuditLog (action="journal_entry.fix_armi_duplicate_lines").
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/fix-armi-entries-688-724-733-1333.ts [companyId] [--commit]
 */
import { PrismaClient, type AccountType } from "@prisma/client";
import { loadExcelLines, type ExcelLine } from "./investigate-armi-full-reconciliation";

const prisma = new PrismaClient();
const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";
const BALANCE_EPSILON = 0.01;

interface TargetLineSpec {
  account: string;
  debit: number;
  credit: number;
}

export interface TargetEntrySpec {
  num: number;
  entryNumber: string;
  originalMemo: string;
  targetMemo: string;
  targetLines: TargetLineSpec[];
}

// الأربعة المستهدَفة — الحالة الصحيحة (المرجع: qoyod_master_reference.csv)، أكّدها المستخدم يدوياً.
export const TARGET_ENTRIES: TargetEntrySpec[] = [
  {
    num: 688,
    entryNumber: "J00610",
    originalMemo: "قيد يدوي رقم 688 - أنشئ بواسطة Kashif Ali",
    targetMemo: "Gosi Amount paid through tism pro",
    targetLines: [
      { account: "التأمينات الاجتماعية (GOSI)", debit: 3935.48, credit: 0 },
      { account: "شركة يسم للتجارة", debit: 0, credit: 3935.48 },
    ],
  },
  {
    num: 724,
    entryNumber: "J00711",
    originalMemo: "قيد يدوي رقم 724 - أنشئ بواسطة Kashif Ali",
    targetMemo: "Sold Accelerator Device of Camry (from Scrap)",
    targetLines: [
      { account: "الصندوق النقدي - الإدارة العامة", debit: 50, credit: 0 },
      { account: "الايرادات من بيع السكراب", debit: 0, credit: 50 },
    ],
  },
  {
    num: 733,
    entryNumber: "J00723",
    originalMemo: "قيد يدوي رقم 733 - أنشئ بواسطة Kashif Ali",
    targetMemo: "Kashif send 500 to islam for Fire generator equipment purchasing",
    targetLines: [
      { account: "عهدة اسلام احمد", debit: 500, credit: 0 },
      { account: "الصندوق النقدي - الإدارة العامة", debit: 0, credit: 500 },
    ],
  },
  {
    num: 1333,
    entryNumber: "J01311",
    originalMemo: "قيد يدوي رقم 1333 - أنشئ بواسطة Kashif Ali",
    targetMemo: "Fuel expense of Yaris",
    targetLines: [
      { account: "مصاريف وقود الموظف", debit: 68, credit: 0 },
      { account: "المصروفات النثرية مع أولا", debit: 0, credit: 68 },
    ],
  },
];

interface ForeignMovementSpec {
  label: string;
  // اسم الحساب كما يظهر حرفياً في ملفات المرجع (قيود) — يختلف أحياناً عن اسم الحساب المقابل في
  // شجرة حسابات أثر (مثال: "المدينون" في قيود مقابل "عملاء - مبيعات جملة/عقود" في أثر). اكتُشف
  // هذا الاختلاف فعلياً أثناء بناء هذا السكريبت (بحث أول بأسماء أثر رجّع صفر نتائج للعشرة كلها،
  // فتأكّدنا بفحص الأسماء الـ83 الفعلية في المرجع قبل الاستقرار على هذه القائمة). هذه الخطوة
  // معلوماتية بحتة (بحث في ملفات المرجع الخام، لا في شجرة حسابات أثر إطلاقاً)، فلا علاقة لها
  // بمشكلة تسمية حساب البنك الأهلي في أثر نفسه (راجع printBalanceImpactTable أدناه).
  refAccount: string;
  amount: number;
  direction: "debit" | "credit";
}

// الحركات "الأجنبية" المطلوب التحقق من وجودها كاملة في مكان آخر بالمرجع (733/1333) — راجع رأس
// الملف. القائمة والمبالغ منقولة حرفياً من وصف الحالة الحالية الذي قدَّمه المستخدم؛ أسماء الحسابات
// هنا هي أسماء المرجع (قيود) الفعلية، لا أسماء أثر.
export const FOREIGN_MOVEMENTS_TO_INVESTIGATE: ForeignMovementSpec[] = [
  { label: "733: عملاء (المدينون) - دفعة ضمن فاتورة مبيعات (1,000 مدين)", refAccount: "المدينون", amount: 1000, direction: "debit" },
  { label: "1333: عملاء (المدينون) - دفعة ضمن فاتورة مبيعات (25,000 مدين)", refAccount: "المدينون", amount: 25000, direction: "debit" },
  { label: "733: ضريبة القيمة المضافة المستحقة (65 دائن)", refAccount: "ضريبة القيمة المضافة المستحقة", amount: 65, direction: "credit" },
  { label: "1333: ضريبة القيمة المضافة المستحقة (3,261 دائن)", refAccount: "ضريبة القيمة المضافة المستحقة", amount: 3261, direction: "credit" },
  { label: "733: إيرادات قطع الغيار (435 دائن)", refAccount: "إيرادات قطع الغيار", amount: 435, direction: "credit" },
  { label: "1333: الايرادات من بيع السكراب (21,739 دائن)", refAccount: "الايرادات من بيع السكراب", amount: 21739, direction: "credit" },
  { label: "733: سند قبض — بنك الأهلي 12300001016808 (500 مدين)", refAccount: "حساب البنك الاهلي 12300001016808", amount: 500, direction: "debit" },
  { label: "1333: سند قبض — بنك الراجحي (25,000 مدين)", refAccount: "بنك الراجحي", amount: 25000, direction: "debit" },
  { label: "733: عملاء (المدينون) - تسوية سند القبض (500 دائن)", refAccount: "المدينون", amount: 500, direction: "credit" },
  { label: "1333: عملاء (المدينون) - تسوية سند القبض (25,000 دائن)", refAccount: "المدينون", amount: 25000, direction: "credit" },
];

// المبالغ الفعلية في قيود تحمل كسوراً صغيرة (فلوس/هللات) عن الأرقام المستديرة التي وصفها المستخدم
// (لوحظ فعلياً أثناء البناء: 25,000 → 25000.05، 65 → 65.22، 3,261 → 3260.88، 435 → 434.78،
// 21,739 → 21739.17) — هذه خطوة استقصاء معلوماتية فقط (لا تؤثر على مبالغ التصحيح الفعلية، المأخوذة
// حصراً من TARGET_ENTRIES المؤكَّدة يدوياً)، فسماحية أوسع هنا مناسبة لتفادي نتائج سلبية كاذبة بسبب
// فروق التقريب.
const INVESTIGATION_EPSILON = 1;

export function amountKey(debit: number, credit: number): string {
  return `${Math.round(debit * 100)}|${Math.round(credit * 100)}`;
}

export interface DbLine {
  id: string;
  accountId: string;
  accountName: string;
  debit: number;
  credit: number;
}

interface ResolvedLine {
  accountId: string;
  accountName: string;
  debit: number;
  credit: number;
}

// مطابقة متعددة المجموعات (multiset) — نفس منطق fix-armi-seven-entries.ts، بلا استيراد متبادل
// بين سكريبتات تصحيح منفصلة تماماً (تصحيحات مختلفة الطبيعة لقيود مختلفة).
export function linesMatch(current: DbLine[], target: ResolvedLine[]): boolean {
  if (current.length !== target.length) return false;
  const counts = new Map<string, number>();
  for (const l of current) {
    const k = `${l.accountId}|${amountKey(l.debit, l.credit)}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const t of target) {
    const k = `${t.accountId}|${amountKey(t.debit, t.credit)}`;
    const have = counts.get(k) || 0;
    if (have === 0) return false;
    counts.set(k, have - 1);
  }
  return [...counts.values()].every((c) => c === 0);
}

// يختار من الأسطر الحالية نسخة واحدة بالضبط من كل سطر مستهدَف (بالـid الأصلي، بلا حذف/إعادة
// إنشاء لها)، ويعتبر الباقي "للحذف". يرجع null لو تعذّر إيجاد نسخة واحدة على الأقل من أي سطر
// مستهدَف ضمن الأسطر الحالية (لا يجب أن يحدث فعلياً حسب التحقيق، لكنه فحص دفاعي).
export function selectKeepAndDelete(current: DbLine[], target: ResolvedLine[]): { keep: DbLine[]; toDelete: DbLine[] } | null {
  const remaining = [...current];
  const keep: DbLine[] = [];
  for (const t of target) {
    const idx = remaining.findIndex((l) => l.accountId === t.accountId && amountKey(l.debit, l.credit) === amountKey(t.debit, t.credit));
    if (idx === -1) return null;
    keep.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return { keep, toDelete: remaining };
}

function normalBalanceSign(type: AccountType): 1 | -1 {
  return type === "asset" || type === "expense" ? 1 : -1;
}

function signedAmount(sign: 1 | -1, debit: number, credit: number): number {
  return sign === 1 ? debit - credit : credit - debit;
}

function investigateForeignMovements(excelLines: ExcelLine[]) {
  console.log(`=== خطوة الاستقصاء الإلزامية: البحث عن الحركات "الأجنبية" في 733/1333 داخل المرجع الكامل ===`);
  for (const mv of FOREIGN_MOVEMENTS_TO_INVESTIGATE) {
    const matches = excelLines.filter((l) => {
      if (l.account !== mv.refAccount) return false;
      const amt = mv.direction === "debit" ? l.debit : l.credit;
      return Math.abs(amt - mv.amount) < INVESTIGATION_EPSILON;
    });
    if (matches.length === 0) {
      console.log(`  ❓ ${mv.label} — غير موجودة في المرجع نهائياً (بحثاً عن حساب "${mv.refAccount}").`);
    } else {
      matches.forEach((m) => {
        const actual = mv.direction === "debit" ? m.debit : m.credit;
        console.log(`  ✅ ${mv.label} — موجودة تحت المرجع "${m.reference}" بتاريخ ${m.date} (القيمة الفعلية=${actual.toFixed(2)}، الوصف: "${m.description}").`);
      });
    }
  }
  console.log();
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

// يُشتَق نطاق الحسابات المطلوب تقريرها ديناميكياً من الحسابات الفعلية التي تخصّها الأسطر
// المحذوفة فعلاً (بدل قائمة أسماء ثابتة مُسبَقة) — لسببين اكتُشفا فعلياً أثناء المراجعة:
//   (أ) قائمة ثابتة بأسماء افتراضية عرضة لعدم مطابقة الاسم الفعلي الدقيق في شجرة حسابات الشركة
//       حرفياً (حدث فعلاً مع "بنك الأهلي 12300001016808" — لم يُطابَق رغم أنه سيُحذَف منه مبلغ
//       فعلي)، بينما DbLine يحمل بالفعل accountId/accountName الحقيقيين من القيد نفسه — لا حاجة
//       لإعادة البحث بالاسم إطلاقاً.
//   (ب) قائمة ثابتة أغفلت حسابات "الزوج الصحيح" نفسها رغم تأثّرها فعلاً: نسخته المكرَّرة (وليس
//       المُبقاة) تُحذَف أيضاً — فحسابات مثل "التأمينات الاجتماعية (GOSI)" أو "عهدة اسلام احمد"
//       تفقد سطراً مكرَّراً حقيقياً ويجب ظهورها في الجدول، لا فقط الحسابات "الأجنبية".
//
// نطاق حساب الرصيد: bulk_import فقط (قيود أرمي المستوردة من قيود تحديداً) — لا رصيد الشركة الحي
// الكامل. أرمي شركة عميل حقيقية تستخدم أثر فعلياً بعد الاستيراد، فرصيد الحساب على مستوى الشركة
// كاملة يخلط نشاطاً حياً لاحقاً غير ذي صلة بهذا التصحيح مع الأرصدة التاريخية المستورَدة — يُنتج هذا
// أرقاماً مضلِّلة (مثال فعلي اكتُشف أثناء المراجعة: حساب ضريبة دائن الطبيعة يظهر رصيده الكلي مديناً
// بسبب سداد ضريبة لاحق غير متصل بهذا التصحيح إطلاقاً)، لا خطأ في معادلة الإشارة نفسها.
async function printBalanceImpactTable(companyId: string, deleteLinesAll: DbLine[]) {
  console.log(`=== جدول أثر التعديل على أرصدة كل الحسابات المتأثرة فعلياً (نطاق قيود أرمي المستورَدة bulk_import فقط، لا كامل نشاط الشركة الحي) ===`);
  const accountIds = [...new Set(deleteLinesAll.map((l) => l.accountId))];
  const affectedAccounts: AccountRow[] = accountIds.length
    ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, code: true, name: true, type: true } })
    : [];
  const byId = new Map(affectedAccounts.map((a) => [a.id, a]));

  for (const accountId of accountIds) {
    const acc = byId.get(accountId);
    if (!acc) {
      const sample = deleteLinesAll.find((l) => l.accountId === accountId);
      console.log(`  ⚠️ حساب "${sample?.accountName}" (id=${accountId}) لم يُعثَر عليه في شجرة الحسابات الحالية (أُرشِف أو حُذف؟) — تخطّي هذا السطر من الجدول.`);
      continue;
    }
    const sign = normalBalanceSign(acc.type);
    const normalSide = sign === 1 ? "مدين" : "دائن";
    const lines = await prisma.journalEntryLine.findMany({
      where: { accountId: acc.id, journalEntry: { companyId, sourceModule: "bulk_import" } },
      select: { debit: true, credit: true },
    });
    const rawDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const rawCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
    const before = signedAmount(sign, rawDebit, rawCredit);

    const removedLines = deleteLinesAll.filter((l) => l.accountId === accountId);
    const removedDebit = removedLines.reduce((s, l) => s + l.debit, 0);
    const removedCredit = removedLines.reduce((s, l) => s + l.credit, 0);
    const removed = signedAmount(sign, removedDebit, removedCredit);
    const after = before - removed;

    console.log(`  ${acc.name} (${acc.code}) [الطبيعة: ${normalSide}]`);
    console.log(`    الرصيد الحالي (bulk_import فقط): إجمالي مدين=${rawDebit.toFixed(2)} / إجمالي دائن=${rawCredit.toFixed(2)} → صافي=${before.toFixed(2)}`);
    console.log(`    سيُحذَف: مدين=${removedDebit.toFixed(2)} / دائن=${removedCredit.toFixed(2)} → صافي=${removed.toFixed(2)}`);
    console.log(`    الرصيد بعد التصحيح: صافي=${after.toFixed(2)}`);
  }
  console.log();
}

function mapLines(lines: { id: string; accountId: string; debit: unknown; credit: unknown; account: { name: string } | null }[]): DbLine[] {
  return lines.map((l) => ({ id: l.id, accountId: l.accountId, accountName: l.account?.name || "", debit: Number(l.debit), credit: Number(l.credit) }));
}

function printCurrentEntryState(spec: TargetEntrySpec, entryNumber: string, dbId: string, memo: string | null, lines: DbLine[]) {
  console.log(`--- القيد الأصلي رقم ${spec.num} (entryNumber=${entryNumber}, id=${dbId}) ---`);
  console.log(`  البيان الحالي: "${memo}"`);
  console.log(`  الأسطر الحالية (${lines.length} سطراً):`);
  lines.forEach((l) => console.log(`    ${l.accountName} | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)}`));
}

interface PreparedFix {
  spec: TargetEntrySpec;
  dbId: string;
  entryNumber: string;
  currentMemo: string | null;
  keepLines: DbLine[];
  deleteLines: DbLine[];
}

export async function run(companyId: string, commit: boolean) {
  console.log(`=== تصحيح أربعة قيود أرمي (688, 724, 733, 1333) — companyId=${companyId} ${commit ? "(--commit: سيُنفَّذ فعلياً)" : "(Dry-run، بلا أي كتابة)"} ===\n`);

  const excelLines = loadExcelLines();
  investigateForeignMovements(excelLines);

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, tenantId: true, fiscalYearClosingDate: true } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);

  const accounts: AccountRow[] = await prisma.account.findMany({
    where: { tenantId: company.tenantId, companyId, isPosting: true, isArchived: false, isActive: true },
    select: { id: true, code: true, name: true, type: true },
  });
  const byExactName = new Map<string, AccountRow[]>();
  for (const a of accounts) {
    const key = a.name.trim();
    byExactName.set(key, [...(byExactName.get(key) || []), a]);
  }

  function resolveTargetLines(spec: TargetEntrySpec): { resolved: ResolvedLine[] } | { problem: string } {
    const resolved: ResolvedLine[] = [];
    for (const line of spec.targetLines) {
      const candidates = byExactName.get(line.account.trim()) || [];
      if (candidates.length === 1) {
        resolved.push({ accountId: candidates[0].id, accountName: candidates[0].name, debit: line.debit, credit: line.credit });
      } else if (candidates.length === 0) {
        return { problem: `القيد ${spec.num}: الحساب "${line.account}" غير موجود في شجرة حسابات الشركة — لا يمكن تصحيح هذا القيد حتى يُحل.` };
      } else {
        return { problem: `القيد ${spec.num}: الحساب "${line.account}" غامض (${candidates.length} حسابات بنفس الاسم) — لا يمكن الربط تلقائياً بثقة.` };
      }
    }
    return { resolved };
  }

  const problems: string[] = [];
  const prepared: PreparedFix[] = [];
  const alreadyCorrect: { spec: TargetEntrySpec; entryNumber: string }[] = [];

  console.log(`=== تحديد القيود الأربعة (بمعرّفاتها الداخلية، قبل أي كتابة) ===\n`);

  for (const spec of TARGET_ENTRIES) {
    const targetResolution = resolveTargetLines(spec);
    if ("problem" in targetResolution) {
      problems.push(targetResolution.problem);
      continue;
    }
    const resolvedTarget = targetResolution.resolved;

    const exactMemoMatches = await prisma.journalEntry.findMany({
      where: { companyId, memo: spec.originalMemo },
      include: { lines: { include: { account: true } } },
    });

    if (exactMemoMatches.length > 1) {
      throw new Error(
        `🛑 توقف تنفيذ السكريبت بالكامل — لا تعديل تم على أي قيد: البيان الأصلي للقيد ${spec.num} ("${spec.originalMemo}") رجّع ${exactMemoMatches.length} نتيجة بدل نتيجة واحدة بالضبط (أرقام القيود المطابقة: ${exactMemoMatches.map((e) => e.entryNumber).join(", ")}). راجع يدوياً قبل أي محاولة أخرى.`,
      );
    }

    let dbId: string;
    let dbEntryNumber: string;
    let currentMemo: string | null;
    let currentLines: DbLine[];

    if (exactMemoMatches.length === 1) {
      const e = exactMemoMatches[0];
      dbId = e.id;
      dbEntryNumber = e.entryNumber;
      currentMemo = e.memo;
      currentLines = mapLines(e.lines);
      printCurrentEntryState(spec, dbEntryNumber, dbId, currentMemo, currentLines);

      const selection = selectKeepAndDelete(currentLines, resolvedTarget);
      if (!selection) {
        problems.push(`القيد ${spec.num}: تعذّر إيجاد نسخة واحدة على الأقل من كل سطر مستهدَف ضمن الأسطر الحالية — لا يمكن المتابعة آلياً، راجع يدوياً.`);
        continue;
      }
      prepared.push({ spec, dbId, entryNumber: dbEntryNumber, currentMemo, keepLines: selection.keep, deleteLines: selection.toDelete });
      continue;
    }

    // صفر نتائج بالبيان الأصلي — إما القيد صُحِّح بالفعل (idempotent) أو مشكلة حقيقية
    const byNumber = await prisma.journalEntry.findUnique({
      where: { companyId_entryNumber: { companyId, entryNumber: spec.entryNumber } },
      include: { lines: { include: { account: true } } },
    });
    if (!byNumber) {
      throw new Error(
        `🛑 توقف تنفيذ السكريبت بالكامل — لا تعديل تم على أي قيد: لا يوجد أي قيد بالبيان الأصلي "${spec.originalMemo}" للقيد ${spec.num}، ولا حتى بالرقم المتوقَّع ${spec.entryNumber}. راجع يدوياً.`,
      );
    }
    const byNumberLines = mapLines(byNumber.lines);
    const alreadyMatchesTarget = byNumber.memo === spec.targetMemo && linesMatch(byNumberLines, resolvedTarget);
    if (!alreadyMatchesTarget) {
      printCurrentEntryState(spec, byNumber.entryNumber, byNumber.id, byNumber.memo, byNumberLines);
      throw new Error(
        `🛑 توقف تنفيذ السكريبت بالكامل — لا تعديل تم على أي قيد: القيد ${spec.num} (entryNumber=${spec.entryNumber}) لا يحمل البيان الأصلي المتوقَّع ولا حالته المصحَّحة المستهدَفة — حالة غير متوقَّعة تحتاج مراجعة يدوية قبل أي محاولة أخرى.`,
      );
    }
    printCurrentEntryState(spec, byNumber.entryNumber, byNumber.id, byNumber.memo, byNumberLines);
    console.log(`  ✅ مطابق تماماً للحالة المستهدَفة بالفعل (idempotent) — سيُتخطَّى بصمت.\n`);
    alreadyCorrect.push({ spec, entryNumber: byNumber.entryNumber });
  }

  if (problems.length) {
    console.log(`⚠️ مشاكل تمنع تصحيح بعض القيود (لن تُلمَس هذه القيود إطلاقاً):`);
    problems.forEach((p) => console.log(`  - ${p}`));
    console.log();
  }

  const closingDate = company.fiscalYearClosingDate;

  // فحص إقفال السنة المالية: يُقرأ تاريخ كل قيد مُعَد للتصحيح (بلا أي تعديل عليه إطلاقاً — التاريخ
  // خارج نطاق هذا السكريبت كلياً)، ويُستبعَد من التنفيذ لو وقع في/قبل تاريخ الإقفال.
  const preparedWithDates = await Promise.all(
    prepared.map(async (p) => {
      const e = await prisma.journalEntry.findUnique({ where: { id: p.dbId }, select: { date: true } });
      return { ...p, date: e!.date };
    }),
  );
  const closed = preparedWithDates.filter((p) => closingDate && p.date.getTime() <= closingDate.getTime());
  const toProcess = preparedWithDates.filter((p) => !closed.includes(p));

  if (closed.length) {
    console.log(`🛑 ${closed.length} قيداً بتاريخ يقع في أو قبل تاريخ إقفال السنة المالية (${closingDate!.toISOString().slice(0, 10)}) — لن يُلمَس أي منها:`);
    closed.forEach((p) => console.log(`  القيد ${p.spec.num} بتاريخ ${p.date.toISOString().slice(0, 10)}`));
    console.log();
  }

  if (alreadyCorrect.length) {
    console.log(`✅ ${alreadyCorrect.length} قيداً صحيح بالفعل (لا حاجة لأي تعديل): ${alreadyCorrect.map((a) => a.spec.num).join(", ")}\n`);
  }

  console.log(`=== ${commit ? "سيُنفَّذ الآن" : "Dry-run — تفصيل ما سيُصحَّح"}: ${toProcess.length} قيداً ===\n`);
  const allDeleteLines: DbLine[] = [];
  for (const fix of toProcess) {
    console.log(`--- القيد ${fix.spec.num} (entryNumber=${fix.entryNumber}) ---`);
    console.log(`  البيان: "${fix.currentMemo}" -> "${fix.spec.targetMemo}"`);
    console.log(`  الأسطر التي ستبقى (بنفس الـid، ${fix.keepLines.length} سطراً):`);
    fix.keepLines.forEach((l) => console.log(`    [id=${l.id}] ${l.accountName} | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)}`));
    console.log(`  الأسطر التي ستُحذَف (${fix.deleteLines.length} سطراً):`);
    fix.deleteLines.forEach((l) => console.log(`    [id=${l.id}] ${l.accountName} | مدين=${l.debit.toFixed(2)} دائن=${l.credit.toFixed(2)}`));
    const totalDebit = fix.keepLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = fix.keepLines.reduce((s, l) => s + l.credit, 0);
    const balanced = Math.abs(totalDebit - totalCredit) < BALANCE_EPSILON;
    console.log(`  التوازن بعد التعديل: مدين=${totalDebit.toFixed(2)} ${balanced ? "=" : "≠"} دائن=${totalCredit.toFixed(2)} ${balanced ? "✅" : "❌"}`);
    console.log();
    allDeleteLines.push(...fix.deleteLines);
  }

  await printBalanceImpactTable(companyId, allDeleteLines);

  if (!commit) {
    console.log(`(وضع Dry-run — لم يُكتَب أي شيء. أعد التشغيل بإضافة --commit للتنفيذ الفعلي بعد المراجعة والموافقة الصريحة.)`);
    return;
  }

  if (toProcess.length === 0) {
    console.log(`لا شيء يحتاج تصحيحاً — كل القيود القابلة للمعالجة صحيحة بالفعل.`);
    return;
  }

  console.log(`--commit مفعَّل: تصحيح ${toProcess.length} قيداً فعلياً الآن، كل قيد في معاملة مستقلة...`);
  let succeeded = 0;
  const failed: { num: number; error: string }[] = [];
  for (const fix of toProcess) {
    try {
      await prisma.$transaction(async (tx) => {
        if (fix.deleteLines.length) {
          await tx.journalEntryLine.deleteMany({ where: { id: { in: fix.deleteLines.map((l) => l.id) } } });
        }
        await tx.journalEntry.update({ where: { id: fix.dbId }, data: { memo: fix.spec.targetMemo } });
        await tx.auditLog.create({
          data: {
            tenantId: company.tenantId,
            userId: null,
            action: "journal_entry.fix_armi_duplicate_lines",
            entityType: "JournalEntry",
            entityId: fix.dbId,
            metadata: {
              scriptName: "fix-armi-entries-688-724-733-1333",
              originalNumber: fix.spec.num,
              entryNumber: fix.entryNumber,
              previousMemo: fix.currentMemo,
              newMemo: fix.spec.targetMemo,
              keptLineIds: fix.keepLines.map((l) => l.id),
              deletedLines: fix.deleteLines.map((l) => ({ id: l.id, accountId: l.accountId, accountName: l.accountName, debit: l.debit, credit: l.credit })),
            },
          },
        });
      });
      succeeded++;
      console.log(`  ✅ القيد ${fix.spec.num} صُحِّح بنجاح.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ num: fix.spec.num, error: message });
      console.log(`  ❌ القيد ${fix.spec.num} فشل: ${message}`);
    }
  }

  console.log(`\nتم بنجاح: ${succeeded} قيداً من ${toProcess.length}.`);
  if (failed.length) {
    console.log(`⚠️ فشل ${failed.length} قيداً — أعد تشغيل نفس الأمر لإعادة محاولتها فقط (القيود الناجحة الأخرى لن تتأثر):`);
    failed.forEach((f) => console.log(`  القيد ${f.num}: ${f.error}`));
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
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
