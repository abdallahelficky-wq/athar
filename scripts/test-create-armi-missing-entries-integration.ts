/**
 * اختبار تكامل محلي كامل (Prisma حقيقي على قاعدة بيانات محلية، لا وحدات مُقلَّدة) لـ
 * create-armi-missing-entries.ts، قبل أي اقتراب من الإنتاج الفعلي لشركة أرمي الحقيقية.
 *
 * يُنشئ tenant/company تجريبيين مؤقتين تحت هذا الـtenant فقط، بحسابات تحمل نفس الأسماء الحقيقية
 * التي تستخدمها القيود العشرون المستهدَفة فعلياً (PYT1-12, INV1-8) — لأن run() في السكريبت الحقيقي
 * يقرأ دائماً من reference/armi_statement_*.csv الحقيقية (لا بيانات تركيبية)، فالاختبار هنا يختبر
 * فعلياً نفس الـ20 قيداً الحقيقية المستهدَفة، لكن على شركة تجريبية معزولة تماماً بدل الإنتاج.
 *
 * يغطي: (1) المسار السعيد الكامل (Dry-run ثم --commit ثم إعادة تشغيل للتأكد من idempotency)،
 * (2) التوقف الآمن الكامل عند غياب حساب واحد فقط (لا إنشاء لأي قيد، لا حتى الذي لا يستخدم ذلك
 * الحساب)، (3) التوقف الآمن الكامل عند وجود تاريخ إقفال سنة مالية يشمل قيداً واحداً على الأقل.
 * يحذف كل بياناته التجريبية في النهاية بغض النظر عن النجاح أو الفشل.
 *
 * التشغيل: DATABASE_URL=<محلي> npx tsx scripts/test-create-armi-missing-entries-integration.ts
 */
import { PrismaClient } from "@prisma/client";
import { run, ACCOUNT_NAME_TO_CODE_OVERRIDES } from "./create-armi-missing-entries";
import { loadExcelLines, groupExcelEntries } from "./investigate-armi-full-reconciliation";

const prisma = new PrismaClient();

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// نفس أسماء الحسابات الحقيقية التي تستخدمها القيود العشرون المستهدَفة فعلياً في reference/*.csv —
// مُستخرَجة هنا مباشرة من الملفات الحقيقية بدل تكرارها يدوياً، لضمان عدم انحراف الاختبار عن الواقع.
function realTargetAccountNames(): string[] {
  const excelLines = loadExcelLines();
  const excelEntries = groupExcelEntries(excelLines);
  const targets = [...excelEntries.values()].filter((e) => e.pattern === "PYT" || e.pattern === "INV");
  return [...new Set(targets.flatMap((e) => e.lines.map((l) => l.account)))];
}

async function createTempTenantAndCompany(namePrefix: string) {
  const tenant = await prisma.tenant.create({
    data: { name: `${namePrefix} tenant`, unlockPin: "test-placeholder-not-a-real-hash" },
  });
  const company = await prisma.company.create({
    data: { tenantId: tenant.id, name: `${namePrefix} company` },
  });
  return { tenant, company };
}

// الأسماء الفعلية الحقيقية في أثر للحسابات الثلاثة ذات خريطة التحويل الصريحة — تُستخدَم هنا فقط
// لواقعية بيانات الاختبار (المطابقة الفعلية تتم بالكود لا بالاسم لهذه الثلاثة، فالاسم هنا تجميلي).
const OVERRIDE_DISPLAY_NAMES: Record<string, string> = {
  "112001": "عملاء - مبيعات جملة/عقود",
  "213001": "ضريبة القيمة المضافة المستحقة (مبيعات)",
  "111001": "الصندوق النقدي - الإدارة العامة",
};

async function createAccounts(tenantId: string, companyId: string, names: string[]) {
  let code = 100000;
  for (const name of names) {
    const overrideCode = ACCOUNT_NAME_TO_CODE_OVERRIDES[name.trim()];
    if (overrideCode) {
      await prisma.account.create({
        data: { tenantId, companyId, code: overrideCode, level: 4, isPosting: true, name: OVERRIDE_DISPLAY_NAMES[overrideCode] || name, type: "asset" },
      });
      continue;
    }
    code++;
    await prisma.account.create({
      data: { tenantId, companyId, code: String(code), level: 4, isPosting: true, name, type: "asset" },
    });
  }
}

async function cleanupTenant(tenantId: string) {
  // JournalEntryLine.accountId هو onDelete: Restrict عمداً (سلامة مالية: لا يُحذَف حساب له ترحيلات
  // تاريخية) — حذف الـtenant مباشرة يفشل لو كانت هناك قيود منشأة، لأن حذف الحسابات المتسلسل (عبر
  // Company) قد يسبقها قبل حذف الأسطر التي تشير إليها. يجب حذف القيود (وأسطرها تِبَعاً، Cascade
  // من JournalEntry) أولاً صراحةً، ثم حذف الـtenant (يكفي بعدها لباقي الجداول: Company/Account
  // كلاهما Cascade من Tenant/Company).
  await prisma.journalEntry.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

async function main() {
  const accountNames = realTargetAccountNames();
  console.log(`أسماء الحسابات الحقيقية التي تستخدمها القيود العشرون المستهدَفة: ${accountNames.length}`);
  accountNames.forEach((n) => console.log(`  - ${n}`));

  // ============ اختبار 1: المسار السعيد الكامل ============
  console.log(`\n${"=".repeat(60)}\nاختبار 1: المسار السعيد (Dry-run -> --commit -> إعادة تشغيل idempotent)\n${"=".repeat(60)}`);
  const t1 = await createTempTenantAndCompany("happy-path");
  try {
    await createAccounts(t1.tenant.id, t1.company.id, accountNames);

    await run(t1.company.id, false);
    const afterDryRun = await prisma.journalEntry.count({ where: { companyId: t1.company.id } });
    check("Dry-run لا يكتب أي شيء", afterDryRun === 0, `الفعلي=${afterDryRun}`);

    await run(t1.company.id, true);
    const entriesAfterCommit = await prisma.journalEntry.findMany({
      where: { companyId: t1.company.id },
      include: { lines: true },
    });
    check("تم إنشاء 20 قيداً بالضبط", entriesAfterCommit.length === 20, `الفعلي=${entriesAfterCommit.length}`);

    const allBalanced = entriesAfterCommit.every((e) => {
      const debit = e.lines.reduce((s, l) => s + Number(l.debit), 0);
      const credit = e.lines.reduce((s, l) => s + Number(l.credit), 0);
      return Math.abs(debit - credit) < 0.01;
    });
    check("كل قيد من الـ20 متوازن فعلياً (مدين=دائن)", allBalanced);

    const memos = entriesAfterCommit.map((e) => e.memo);
    check('يوجد قيد بـmemo "سند قبض رقم PYT2 - مستورد من قيود"', memos.includes("سند قبض رقم PYT2 - مستورد من قيود"));
    check('يوجد قيد بـmemo "فاتورة مبيعات رقم INV3 - مستورد من قيود"', memos.includes("فاتورة مبيعات رقم INV3 - مستورد من قيود"));

    const allBulkImport = entriesAfterCommit.every((e) => e.sourceModule === "bulk_import");
    check('كل القيود sourceModule="bulk_import"', allBulkImport);

    const entryNumbers = new Set(entriesAfterCommit.map((e) => e.entryNumber));
    check("كل أرقام القيود (entryNumber) فريدة، لا تصادم", entryNumbers.size === 20, `الفعلي=${entryNumbers.size}`);

    // إعادة تشغيل --commit مرة أخرى: يجب ألا يُنشئ أي شيء إضافي (idempotency)
    await run(t1.company.id, true);
    const afterSecondCommit = await prisma.journalEntry.count({ where: { companyId: t1.company.id } });
    check("إعادة تشغيل --commit لا تُنشئ أي تكرار (idempotency)", afterSecondCommit === 20, `الفعلي=${afterSecondCommit}`);

    // وإعادة تشغيل Dry-run بعد النجاح يجب أن يُظهر أن كل شيء موجود بالفعل (لا مشاكل جديدة)
    await run(t1.company.id, false);
  } finally {
    await cleanupTenant(t1.tenant.id);
  }

  // ============ اختبار 2: التوقف الآمن عند غياب حساب واحد ============
  console.log(`\n${"=".repeat(60)}\nاختبار 2: غياب حساب واحد يوقف إنشاء كل الـ20 قيداً، لا فقط ما يستخدمه\n${"=".repeat(60)}`);
  const t2 = await createTempTenantAndCompany("missing-account");
  try {
    const namesMinusOne = accountNames.slice(1); // نحذف أول حساب عمداً
    console.log(`  حساب مفقود عمداً: "${accountNames[0]}"`);
    await createAccounts(t2.tenant.id, t2.company.id, namesMinusOne);

    await run(t2.company.id, true);
    const count2 = await prisma.journalEntry.count({ where: { companyId: t2.company.id } });
    check("لم يُنشأ أي قيد إطلاقاً بسبب حساب واحد مفقود (كل الدفعة تتوقف معاً)", count2 === 0, `الفعلي=${count2}`);
  } finally {
    await cleanupTenant(t2.tenant.id);
  }

  // ============ اختبار 3: التوقف الآمن عند تاريخ إقفال سنة مالية ============
  console.log(`\n${"=".repeat(60)}\nاختبار 3: تاريخ إقفال يشمل قيداً واحداً يوقف إنشاء كل الـ20 قيداً\n${"=".repeat(60)}`);
  const t3 = await createTempTenantAndCompany("fiscal-closing");
  try {
    await createAccounts(t3.tenant.id, t3.company.id, accountNames);
    // كل القيود العشرون تاريخها 2025 أو 2026 — إقفال بتاريخ بعيد في المستقبل يشملها جميعاً بالتأكيد
    await prisma.company.update({ where: { id: t3.company.id }, data: { fiscalYearClosingDate: new Date("2030-01-01T00:00:00.000Z") } });

    await run(t3.company.id, true);
    const count3 = await prisma.journalEntry.count({ where: { companyId: t3.company.id } });
    check("لم يُنشأ أي قيد إطلاقاً بسبب تاريخ إقفال يشمل قيوداً مستهدَفة", count3 === 0, `الفعلي=${count3}`);
  } finally {
    await cleanupTenant(t3.tenant.id);
  }

  console.log(`\n${"=".repeat(40)}`);
  if (failures === 0) {
    console.log("✅ كل اختبارات التكامل نجحت — dry-run/commit/idempotency وكلا مساري التوقف الآمن (حساب مفقود، إقفال سنة مالية) يعملان بدقة على قاعدة بيانات حقيقية.");
    process.exitCode = 0;
  } else {
    console.log(`❌ فشل ${failures} اختباراً — لا تُشغِّل السكريبت الحقيقي على الإنتاج قبل إصلاح هذا.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
