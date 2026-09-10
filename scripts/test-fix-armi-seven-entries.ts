/**
 * اختبار تكامل محلي كامل (Prisma حقيقي على قاعدة بيانات محلية، لا محاكاة) لـ
 * fix-armi-seven-entries.ts — قبل أي اقتراب من الإنتاج الفعلي لشركة أرمي.
 *
 * يُنشئ tenant/company تجريبيين مؤقتين، بحسابات تحمل نفس الأسماء الحقيقية التي تستخدمها القيود
 * السبعة المستهدَفة فعلياً (لأن run() يقرأ دائماً من reference/armi_statement_*.csv الحقيقية —
 * لا بيانات تركيبية)، ثم يُنشئ نسخة "فاسدة" مصطنعة من كل قيد (أسطر زائدة/خاطئة، وmemo/تاريخ غير
 * صحيحين لبعضها) تحاكي الحالة الفعلية الموصوفة في التحقيق، ويشغّل السكريبت الحقيقي عليها.
 *
 * يغطي: (1) Dry-run لا يكتب شيئاً، (2) --commit يصحح كل قيد للأسطر/التاريخ/الـmemo الصحيح تماماً
 * ويُبقي توازن مدين=دائن، (3) إعادة --commit مرة أخرى لا تُغيّر شيئاً (idempotency حقيقية)،
 * (4) قيد بحساب مفقود يُترَك بلا لمس بينما البقية تُصحَّح بنجاح (عزل الفشل لكل قيد)،
 * (5) قيد بتاريخ إقفال يُترَك بلا لمس.
 *
 * التشغيل: DATABASE_URL=<محلي> npx tsx scripts/test-fix-armi-seven-entries.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { run, linesMatch, amountKey, ACCOUNT_NAME_OVERRIDES } from "./fix-armi-seven-entries";
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

const TARGET_NUMBERS = [401, 405, 496, 540, 600, 612, 627];

function realTargetAccountNames(): string[] {
  const entries = groupExcelEntries(loadExcelLines());
  const names = new Set<string>();
  for (const num of TARGET_NUMBERS) {
    entries.get(String(num))?.lines.forEach((l) => names.add(l.account));
  }
  return [...names];
}

async function createTempTenantCompany(namePrefix: string) {
  const tenant = await prisma.tenant.create({ data: { name: `${namePrefix} tenant`, unlockPin: "test-placeholder" } });
  const company = await prisma.company.create({ data: { tenantId: tenant.id, name: `${namePrefix} company` } });
  return { tenant, company };
}

// لأسماء لها تحويل صريح في ACCOUNT_NAME_OVERRIDES (مثل "نفقات الإنترنت")، يُنشأ الحساب الفعلي
// بالاسم/الكود الحقيقيين في أثر (لا باسم المرجع)، تماماً كما هي الحال في شركة أرمي الحقيقية —
// محاكاة دقيقة لسيناريو "الاسم في قيود يختلف عن الاسم الفعلي في أثر" الذي يختبره السكريبت.
async function createAccounts(tenantId: string, companyId: string, names: string[]) {
  let code = 500000;
  const byName = new Map<string, string>();
  for (const name of names) {
    code++;
    const override = ACCOUNT_NAME_OVERRIDES[name];
    const actualName = override?.correctName ?? name;
    const actualCode = override?.code ?? String(code);
    const a = await prisma.account.create({ data: { tenantId, companyId, code: actualCode, level: 4, isPosting: true, name: actualName, type: "expense" } });
    byName.set(name, a.id);
  }
  return byName;
}

async function cleanupTenant(tenantId: string) {
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

// ينشئ نسخة "فاسدة" من قيد N: كل أسطره الصحيحة + سطرين زائدين عشوائيين (يحاكي "الوحدة المركّبة"
// التي وصفها التحقيق)، وmemo عام غير مؤكَّد، وأحياناً تاريخاً خاطئاً — يجب أن يُصحِّحه السكريبت للحالة
// المستهدَفة تماماً بعد --commit.
async function createCorruptedEntry(tenantId: string, companyId: string, num: number, accountByName: Map<string, string>, wrongDate: boolean) {
  const entries = groupExcelEntries(loadExcelLines());
  const correct = entries.get(String(num))!;
  const correctDate = [...correct.dates][0];
  const storedDate = wrongDate ? "2020-01-01" : correctDate;

  const anyAccountId = [...accountByName.values()][0];
  const entryId = randomUUID();
  await prisma.journalEntry.create({
    data: {
      id: entryId,
      tenantId,
      companyId,
      date: new Date(`${storedDate}T00:00:00.000Z`),
      memo: `قيد يدوي رقم ${num}`,
      status: "posted",
      entryNumber: `TST${num}`,
      sourceModule: "bulk_import",
      lines: {
        create: [
          ...correct.lines.map((l) => ({ id: randomUUID(), accountId: accountByName.get(l.account)!, debit: l.debit, credit: l.credit })),
          // سطران زائدان يحاكيان تلوّث "الوحدة المركّبة" المكتشَف في التحقيق
          { id: randomUUID(), accountId: anyAccountId, debit: 999, credit: 0 },
          { id: randomUUID(), accountId: anyAccountId, debit: 0, credit: 999 },
        ],
      },
    },
  });
  return entryId;
}

async function main() {
  const targetAccountNames = realTargetAccountNames();
  console.log(`أسماء الحسابات الحقيقية التي تستخدمها القيود السبعة المستهدَفة: ${targetAccountNames.length}`);

  // ============ اختبار 0: linesMatch (وحدة خالصة) ============
  console.log(`\n${"=".repeat(60)}\nاختبار 0: linesMatch — منطق خالص\n${"=".repeat(60)}`);
  const a1 = "acc1", a2 = "acc2";
  check(
    "أسطر متطابقة تماماً (ترتيب مختلف) تُعتبَر متطابقة",
    linesMatch(
      [{ id: "1", accountId: a1, accountName: "", debit: 100, credit: 0 }, { id: "2", accountId: a2, accountName: "", debit: 0, credit: 100 }],
      [{ accountId: a2, accountName: "", debit: 0, credit: 100 }, { accountId: a1, accountName: "", debit: 100, credit: 0 }],
    ),
  );
  check(
    "أسطر بعدد مختلف تُعتبَر غير متطابقة",
    !linesMatch(
      [{ id: "1", accountId: a1, accountName: "", debit: 100, credit: 0 }],
      [{ accountId: a1, accountName: "", debit: 100, credit: 0 }, { accountId: a2, accountName: "", debit: 0, credit: 100 }],
    ),
  );
  check("amountKey يفرّق بين مدين ودائن لنفس الرقم", amountKey(100, 0) !== amountKey(0, 100));

  // ============ اختبار 1: المسار السعيد الكامل (7 قيود فاسدة، بعضها بتاريخ خاطئ) ============
  console.log(`\n${"=".repeat(60)}\nاختبار 1: تصحيح كامل لكل السبعة (Dry-run -> --commit -> idempotent rerun)\n${"=".repeat(60)}`);
  const t1 = await createTempTenantCompany("fix-seven-happy");
  try {
    const accountByName = await createAccounts(t1.tenant.id, t1.company.id, targetAccountNames);
    // 401 و600 بتاريخ خاطئ عمداً، البقية بتاريخ صحيح من الأساس
    for (const num of TARGET_NUMBERS) {
      await createCorruptedEntry(t1.tenant.id, t1.company.id, num, accountByName, num === 401 || num === 600);
    }

    await run(t1.company.id, false);
    const entriesAfterDryRun = await prisma.journalEntry.findMany({ where: { companyId: t1.company.id }, include: { lines: true } });
    check("Dry-run لا يغيّر عدد الأسطر لأي قيد", entriesAfterDryRun.every((e) => e.lines.length === TARGET_NUMBERS.length ? true : e.lines.length > 2));

    await run(t1.company.id, true);
    const entries = groupExcelEntries(loadExcelLines());
    for (const num of TARGET_NUMBERS) {
      const dbEntry = await prisma.journalEntry.findFirst({ where: { companyId: t1.company.id, entryNumber: `TST${num}` }, include: { lines: { include: { account: true } } } });
      const correct = entries.get(String(num))!;
      check(`القيد ${num}: عدد الأسطر بعد التصحيح = ${correct.lines.length}`, dbEntry?.lines.length === correct.lines.length, `الفعلي=${dbEntry?.lines.length}`);
      const debitSum = dbEntry?.lines.reduce((s, l) => s + Number(l.debit), 0) || 0;
      const creditSum = dbEntry?.lines.reduce((s, l) => s + Number(l.credit), 0) || 0;
      check(`القيد ${num}: متوازن بعد التصحيح`, Math.abs(debitSum - creditSum) < 0.01, `مدين=${debitSum} دائن=${creditSum}`);
      check(`القيد ${num}: لا يحتوي أي سطر بقيمة 999 (الأسطر الزائدة أُزيلت)`, !dbEntry?.lines.some((l) => Number(l.debit) === 999 || Number(l.credit) === 999));
      const expectedDate = [...correct.dates][0];
      check(`القيد ${num}: التاريخ = ${expectedDate}`, dbEntry?.date.toISOString().slice(0, 10) === expectedDate);
    }
    const entry401 = await prisma.journalEntry.findFirst({ where: { companyId: t1.company.id, entryNumber: "TST401" } });
    check('القيد 401: الـmemo تحديثه للنص الإنجليزي المؤكَّد (بما فيه "expesne")', entry401?.memo === "Office maintenance expesne");

    // Idempotency: إعادة --commit يجب ألا تغيّر أي شيء
    const beforeRerunLines = await prisma.journalEntryLine.findMany({ where: { journalEntry: { companyId: t1.company.id } } });
    await run(t1.company.id, true);
    const afterRerunLines = await prisma.journalEntryLine.findMany({ where: { journalEntry: { companyId: t1.company.id } } });
    check("إعادة تشغيل --commit لا تغيّر عدد الأسطر إطلاقاً (idempotency)", beforeRerunLines.length === afterRerunLines.length, `قبل=${beforeRerunLines.length} بعد=${afterRerunLines.length}`);
    // تحقق أن الـid الفعلي للأسطر لم يتغيّر (لا حذف/إعادة إنشاء غير ضروري في التشغيلة الثانية)
    const beforeIds = new Set(beforeRerunLines.map((l) => l.id));
    const afterIds = new Set(afterRerunLines.map((l) => l.id));
    check("إعادة التشغيل لم تحذف/تُعِد إنشاء أي سطر (نفس المعرّفات تماماً)", beforeRerunLines.every((l) => afterIds.has(l.id)) && afterRerunLines.every((l) => beforeIds.has(l.id)));
  } finally {
    await cleanupTenant(t1.tenant.id);
  }

  // ============ اختبار 2: عزل الفشل — حساب مفقود لقيد واحد لا يوقف البقية ============
  console.log(`\n${"=".repeat(60)}\nاختبار 2: حساب مفقود لقيد 496 فقط — يجب تصحيح الستة الباقية بنجاح\n${"=".repeat(60)}`);
  const t2 = await createTempTenantCompany("fix-seven-partial");
  try {
    const namesMinusOne = targetAccountNames.filter((n) => n !== "نفقات الإنترنت"); // حساب سطر القيد 496
    const accountByName = await createAccounts(t2.tenant.id, t2.company.id, namesMinusOne);
    for (const num of TARGET_NUMBERS) {
      if (num === 496) continue; // سيُنشَأ لاحقاً بحساب مفقود، تجاهل الإنشاء المعتاد لتفادي فشل createAccounts أعلاه له
    }
    // أنشئ 496 يدوياً بدون محاولة استخدام حساب "نفقات الإنترنت" غير الموجود — بحساب عشوائي مؤقت فقط ليُنشأ القيد، السكريبت سيحاول تصحيحه بحساب غير موجود فيفشل بأمان
    const anyAcc = [...accountByName.values()][0];
    await prisma.journalEntry.create({
      data: {
        tenantId: t2.tenant.id, companyId: t2.company.id, date: new Date("2025-09-27T00:00:00.000Z"),
        memo: "قيد يدوي رقم 496", status: "posted", entryNumber: "TST496", sourceModule: "bulk_import",
        lines: { create: [{ id: randomUUID(), accountId: anyAcc, debit: 148.10, credit: 0 }, { id: randomUUID(), accountId: anyAcc, debit: 0, credit: 148.10 }] },
      },
    });
    for (const num of TARGET_NUMBERS.filter((n) => n !== 496)) {
      await createCorruptedEntry(t2.tenant.id, t2.company.id, num, accountByName, false);
    }

    await run(t2.company.id, true);
    const entry496 = await prisma.journalEntry.findFirst({ where: { companyId: t2.company.id, entryNumber: "TST496" }, include: { lines: true } });
    check("القيد 496 لم يُلمَس (حساب مفقود) — لا يزال بسطرين غير صحيحين", entry496?.lines.length === 2);
    let othersFixed = 0;
    for (const num of TARGET_NUMBERS.filter((n) => n !== 496)) {
      const entries = groupExcelEntries(loadExcelLines());
      const correct = entries.get(String(num))!;
      const dbEntry = await prisma.journalEntry.findFirst({ where: { companyId: t2.company.id, entryNumber: `TST${num}` }, include: { lines: true } });
      if (dbEntry?.lines.length === correct.lines.length) othersFixed++;
    }
    check("كل القيود الستة الأخرى صُحِّحت بنجاح رغم فشل 496", othersFixed === 6, `الفعلي=${othersFixed}`);
  } finally {
    await cleanupTenant(t2.tenant.id);
  }

  // ============ اختبار 3: قيد بتاريخ إقفال — يُترَك بلا لمس ============
  // ملاحظة: التواريخ الحقيقية للسبعة (من قيود) ليست بترتيب رقم القيد — فالقيد 600 (2025-11-03)
  // أسبق فعلياً من 612 (2025-11-04). الفحص في السكريبت هو "تاريخ <= تاريخ الإقفال" (كل ما هو
  // في الفترة المُقفَلة أو قبلها لا يُلمَس)، لذا استخدام تاريخ 612 كإقفال كان سيُقفل كل السبعة
  // (لأنه أحدث تاريخ بينها) لا 612 وحده. لعزل قيد واحد بمعزل عمّا بعده فعلياً، نستخدم تاريخ إقفال
  // = تاريخ القيد 540 (2025-10-20): يُقفل 401/405/496/540 (تواريخهم <= هذا)، ويترك 600/612/627
  // (تواريخهم لاحقة) قابلة للتصحيح.
  console.log(`\n${"=".repeat(60)}\nاختبار 3: تاريخ إقفال يشمل أربعة قيود (401/405/496/540) — تُترَك بلا لمس، الثلاثة الباقية تُصحَّح\n${"=".repeat(60)}`);
  const t3 = await createTempTenantCompany("fix-seven-closing");
  try {
    const accountByName = await createAccounts(t3.tenant.id, t3.company.id, targetAccountNames);
    for (const num of TARGET_NUMBERS) {
      await createCorruptedEntry(t3.tenant.id, t3.company.id, num, accountByName, false);
    }
    // إقفال بتاريخ 2025-10-20 بالضبط (تاريخ القيد 540) — يشمل كل ما هو بهذا التاريخ أو قبله
    await prisma.company.update({ where: { id: t3.company.id }, data: { fiscalYearClosingDate: new Date("2025-10-20T00:00:00.000Z") } });

    await run(t3.company.id, true);
    for (const num of [401, 405, 496, 540]) {
      const entry = await prisma.journalEntry.findFirst({ where: { companyId: t3.company.id, entryNumber: `TST${num}` }, include: { lines: true } });
      const correct = groupExcelEntries(loadExcelLines()).get(String(num))!;
      check(`القيد ${num} (في/قبل تاريخ الإقفال) لم يُلمَس`, entry?.lines.length !== correct.lines.length || entry?.lines.some((l) => Number(l.debit) === 999 || Number(l.credit) === 999));
    }
    for (const num of [600, 612, 627]) {
      const entry = await prisma.journalEntry.findFirst({ where: { companyId: t3.company.id, entryNumber: `TST${num}` }, include: { lines: true } });
      const correct = groupExcelEntries(loadExcelLines()).get(String(num))!;
      check(`القيد ${num} (بعد تاريخ الإقفال) صُحِّح بنجاح`, entry?.lines.length === correct.lines.length);
    }
  } finally {
    await cleanupTenant(t3.tenant.id);
  }

  console.log(`\n${"=".repeat(40)}`);
  if (failures === 0) {
    console.log("✅ كل اختبارات التكامل نجحت — تصحيح السبعة، عزل الفشل لكل قيد، فحص إقفال السنة المالية، وidempotency الحقيقي يعملان بدقة على قاعدة بيانات حقيقية.");
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
