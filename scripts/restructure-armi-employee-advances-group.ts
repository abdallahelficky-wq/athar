/**
 * سكريبت مباشر على قاعدة البيانات (Prisma) — استثناء متعمَّد عن نمط باقي سكريبتات هذه الجلسة التي
 * تمر دائماً عبر الـ API الحقيقي. السبب: العملية المطلوبة (تحويل حساب من مستوى ترحيل (4) إلى حساب
 * مجموعة (3) + إعادة ترقيم 22 حساباً تحته) تلمس level/code لحسابات موجودة، وهذان الحقلان يُتجاهَلان
 * عمداً في accounts.controller.ts::updateAccount:
 *   const { confirmMoveWithTransactions, code: _ignoredCode, level: _ignoredLevel, ... } = req.body;
 * (بالتصميم — للحفاظ على ثبات الكود كمعرّف تاريخي مستقر للتقارير). لا يوجد إذن أي مسار API عادي
 * يُنفِّذ هذا التغيير، فتم اللجوء لـ Prisma مباشرة، فقط بعد تأكيد المستخدم صراحة وبعد التحقق أدناه
 * أن هذا آمن هنا تحديداً (صفر معاملات على كل الحسابات الـ23 المتأثرة).
 *
 * نطاق العملية محدود تماماً بالمعرّفات الصريحة أدناه — شركة واحدة، حساب واحد يُحوَّل (113002)، و22
 * حساباً يُعاد تفريعها/ترقيمها تحته. لا يلمس أي حساب آخر، ولا يلمس 114007 (المركبات التي تم شراؤها،
 * تحت 114 المخزون) إطلاقاً — يبقى كما هو.
 *
 * قبل أي كتابة فعلية (--commit) يتحقق السكريبت من:
 *   - وجود الحسابات الأساسية (11 / 113 / 113002) وكل الـ22 حساباً بالأكواد والأسماء والمواقع المتوقَّعة
 *     تحديداً في الشجرة — لا افتراض.
 *   - صفر بنود قيود (JournalEntryLine) مرتبطة بأي من الحسابات الـ23 — هذا ما يجعل تغيير level/code
 *     آمناً هنا تحديداً رغم أن الـ API يمنعه عموماً.
 *   - 113002 ليس له أي حساب فرعي حالياً (شرط ضروري لتحويله من حساب ترحيل إلى حساب تجميعي).
 *   - لا تصادم أكواد: 117 (أو أياً كان الكود التالي الفعلي تحت 11) وكل أكواد الأبناء الجديدة غير
 *     مستخدَمة مسبقاً.
 * أي فشل في أحد هذه التحقّقات يُوقِف --commit فوراً بلا أي كتابة جزئية — الكتابة الفعلية بالكامل
 * داخل معاملة (transaction) واحدة ذرية عبر prisma.$transaction.
 *
 * الأكواد الجديدة تُولَّد فعلياً عبر generateNextCode الحقيقية (نفس الدالة التي يستخدمها الـ API عند
 * الإنشاء العادي) — لا تُفرَض يدوياً، فقط دور 113002 كأب يتغيّر برمجياً قبل توليد أكواد الأبناء حتى
 * تقبله الدالة كأب صالح (تشترط level < 4 و isPosting=false).
 *
 * وضع افتراضي: Dry-run (يعرض الحالة الحالية والمتوقَّعة، بلا أي كتابة). للتنفيذ الفعلي مرّر --commit.
 *
 * الاستخدام:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/restructure-armi-employee-advances-group.ts [--commit]
 */
import { PrismaClient } from "@prisma/client";
import { generateNextCode } from "../src/lib/accountCodes";

const prisma = new PrismaClient();

const COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd"; // شركة ارمي للصناعة
const ROOT_PARENT_CODE = "11"; // الأصول المتداولة — الأب الجديد لحساب 113002 بعد تحويله لمجموعة
const OLD_GROUP_CODE = "113"; // ذمم مدينة أخرى — الأب الحالي لكل الحسابات أدناه
const CONVERT_CODE = "113002";
const CONVERT_EXPECTED_NAME = "سلف وقروض الموظفين";
const NEW_GROUP_NAME = "سلف وعهد الموظفين";
const UNTOUCHED_INVENTORY_CODE = "114007"; // المركبات التي تم شراؤها — للعرض فقط، لا يُلمَس

// بالترتيب الأصلي بالضبط كما أُضيفت — بدون 113001/113003/113004/113005 (الأصلية، تبقى تحت 113)
// وبدون 114007 (المخزون، لا يُنقل).
const CHILD_CODES = [
  "113006", "113007", "113008", "113009", "113010", "113011", "113012", "113013", "113014",
  "113015", "113016", "113017", "113018", "113019", "113020", "113021", "113022", "113023",
  "113024", "113025", "113026", "113027",
];

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(`[restructure-armi-employee-advances-group.ts] cwd=${process.cwd()} mode=${commit ? "COMMIT — تنفيذ فعلي" : "DRY-RUN — عرض فقط، بلا أي تعديل"}`);

  const company = await prisma.company.findUnique({ where: { id: COMPANY_ID }, select: { id: true, tenantId: true, name: true } });
  if (!company) {
    console.log(`لم توجد شركة بالمعرّف ${COMPANY_ID} — تم الإيقاف.`);
    process.exit(1);
  }
  console.log(`الشركة: ${company.name} (${company.id})`);

  const root = await prisma.account.findFirst({ where: { companyId: COMPANY_ID, code: ROOT_PARENT_CODE } });
  const oldGroup = await prisma.account.findFirst({ where: { companyId: COMPANY_ID, code: OLD_GROUP_CODE } });
  const convertAccount = await prisma.account.findFirst({ where: { companyId: COMPANY_ID, code: CONVERT_CODE } });

  if (!root || !oldGroup || !convertAccount) {
    console.log(`تعذّر العثور على أحد الحسابات الأساسية: 11=${!!root} 113=${!!oldGroup} 113002=${!!convertAccount} — تم الإيقاف.`);
    process.exit(1);
  }

  const problems: string[] = [];

  if (convertAccount.parentId !== oldGroup.id) problems.push(`113002 أبوه الحالي ليس 113 كما هو متوقَّع.`);
  if (convertAccount.level !== 4) problems.push(`113002 مستواه الحالي ${convertAccount.level} وليس 4 كما هو متوقَّع.`);
  if (!convertAccount.isPosting) problems.push(`113002 ليس حساب ترحيل حالياً كما هو متوقَّع.`);
  if (convertAccount.name !== CONVERT_EXPECTED_NAME) problems.push(`اسم 113002 الحالي "${convertAccount.name}" وليس "${CONVERT_EXPECTED_NAME}" كما هو متوقَّع.`);

  const convertChildrenCount = await prisma.account.count({ where: { parentId: convertAccount.id } });
  if (convertChildrenCount > 0) problems.push(`113002 له بالفعل ${convertChildrenCount} حساب فرعي — لا يمكن تحويله لمجموعة وله حسابات فرعية.`);

  const childAccounts: { id: string; code: string; name: string; parentId: string | null; level: number; isPosting: boolean }[] = [];
  for (const code of CHILD_CODES) {
    const acc = await prisma.account.findFirst({ where: { companyId: COMPANY_ID, code } });
    if (!acc) {
      problems.push(`الحساب بالكود ${code} غير موجود.`);
      continue;
    }
    if (acc.parentId !== oldGroup.id) problems.push(`الحساب ${code} ("${acc.name}") أبوه الحالي ليس 113 كما هو متوقَّع.`);
    if (acc.level !== 4 || !acc.isPosting) problems.push(`الحساب ${code} ("${acc.name}") ليس حساب ترحيل مستوى 4 كما هو متوقَّع.`);
    childAccounts.push(acc);
  }
  if (childAccounts.length !== CHILD_CODES.length) {
    problems.push(`العدد الفعلي للحسابات الموجودة (${childAccounts.length}) لا يطابق العدد المتوقَّع (${CHILD_CODES.length}).`);
  }

  const allTargetIds = [convertAccount.id, ...childAccounts.map((a) => a.id)];
  const journalLinesCount = await prisma.journalEntryLine.count({ where: { accountId: { in: allTargetIds } } });
  if (journalLinesCount > 0) {
    problems.push(`يوجد ${journalLinesCount} بند قيد مرتبط بأحد الحسابات الـ23 — التعديل غير آمن، تم الإيقاف.`);
  }

  const untouchedInventory = await prisma.account.findFirst({ where: { companyId: COMPANY_ID, code: UNTOUCHED_INVENTORY_CODE } });
  console.log(
    untouchedInventory
      ? `تأكيد: "${untouchedInventory.name}" (${untouchedInventory.code}) لن يُلمَس — يبقى كما هو تحت 114.`
      : `ملاحظة: لم يوجد حساب بالكود ${UNTOUCHED_INVENTORY_CODE} (غير خطير، هذا الحساب خارج نطاق هذا السكريبت أصلاً).`,
  );

  if (problems.length > 0) {
    console.log("\nتم إيقاف التنفيذ — المشاكل التالية تمنع المتابعة بأمان:");
    problems.forEach((p) => console.log(`- ${p}`));
    process.exit(1);
  }

  console.log(`\nكل الفحوصات نجحت: 23 حساباً بالحالة المتوقَّعة، صفر بنود قيود مرتبطة، 113002 بلا حسابات فرعية.`);

  if (!commit) {
    // معاينة فقط: نولّد كود المجموعة الحقيقي عبر generateNextCode (قراءة فقط، آمنة) لكن نُحاكي أكواد
    // الأبناء يدوياً محلياً — استدعاء generateNextCode بـ113002 كأب هنا كان سيفشل لأنه لا يزال حالياً
    // (قبل أي تعديل فعلي) حساب ترحيل مستوى 4، وهذا بالضبط ما تتحقق منه الدالة الحقيقية وترفضه بحق.
    const previewGroupCode = await generateNextCode(prisma, company.tenantId, COMPANY_ID, root.id);
    const suffixWidth = 6 - previewGroupCode.length;
    console.log(`\n[DRY-RUN] كان سيصير:`);
    console.log(`  113002 "${convertAccount.name}" → مستوى 3، حساب تجميعي (isPosting=false)، أب جديد="${root.name}" (${root.code})، اسم جديد="${NEW_GROUP_NAME}"، كود جديد="${previewGroupCode}"`);
    childAccounts.forEach((acc, i) => {
      const newCode = previewGroupCode + String(i + 1).padStart(suffixWidth, "0");
      console.log(`  ${acc.code} "${acc.name}" → كود جديد="${newCode}"، أب جديد="${NEW_GROUP_NAME}" (${previewGroupCode})`);
    });
    console.log(`\nانتهى العرض (dry-run). أضف --commit للتنفيذ الفعلي بعد المراجعة.`);
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const groupCode = await generateNextCode(tx, company.tenantId, COMPANY_ID, root.id);
    const updatedGroup = await tx.account.update({
      where: { id: convertAccount.id },
      data: { parentId: root.id, level: 3, isPosting: false, name: NEW_GROUP_NAME, code: groupCode },
    });
    console.log(`تم التحويل: 113002 → "${updatedGroup.name}" (${updatedGroup.code}), مستوى ${updatedGroup.level}, حساب تجميعي.`);

    const moved: { oldCode: string; newCode: string; name: string }[] = [];
    for (const acc of childAccounts) {
      const newCode = await generateNextCode(tx, company.tenantId, COMPANY_ID, updatedGroup.id);
      await tx.account.update({ where: { id: acc.id }, data: { parentId: updatedGroup.id, code: newCode } });
      moved.push({ oldCode: acc.code, newCode, name: acc.name });
      console.log(`  ${acc.code} → ${newCode}  "${acc.name}"`);
    }
    return { updatedGroup, moved };
  });

  console.log(`\nانتهى التنفيذ. المجموعة الجديدة: "${result.updatedGroup.name}" (${result.updatedGroup.code}) — عدد الحسابات المنقولة: ${result.moved.length}.`);
}

main()
  .catch((err) => {
    console.log("خطأ غير متوقع:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
