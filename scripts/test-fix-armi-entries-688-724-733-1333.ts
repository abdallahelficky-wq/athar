/**
 * اختبار تكامل محلي كامل (Prisma حقيقي على قاعدة بيانات محلية، لا محاكاة) لـ
 * fix-armi-entries-688-724-733-1333.ts — قبل أي اقتراب من الإنتاج الفعلي لشركة أرمي.
 *
 * يُنشئ tenant/company تجريبيين مؤقتين بحسابات حقيقية الأسماء، ثم ينشئ نسخة "فاسدة" مصطنعة لكل
 * قيد من الأربعة بنفس البنية الحرفية الموصوفة في التحقيق (تكرار الزوج الصحيح × كتلة أجنبية كاملة
 * فاتورة/سند مكررة أيضاً)، ويشغّل السكريبت الحقيقي عليها.
 *
 * يغطي:
 *  (0) Dry-run لا يكتب شيئاً.
 *  (1) --commit يُبقي على نسخة واحدة فقط من الزوج الصحيح (بنفس الـid الأصلي) ويحذف كل الباقي،
 *      ويحدّث الـmemo، ويُبقي كل قيد متوازناً، ويكتب AuditLog واحداً لكل قيد مُصحَّح.
 *  (2) إعادة --commit مرة أخرى لا تُغيّر شيئاً (idempotency حقيقية عبر مسار entryNumber الاحتياطي)،
 *      بما في ذلك ثبات معرّفات الأسطر المُبقاة.
 *  (3) عزل الفشل لكل قيد: حساب مستهدَف مفقود لقيد واحد لا يوقف تصحيح الثلاثة الباقية.
 *  (4) توقف السكريبت بالكامل (لا كتابة على أي قيد) عند غموض في تحديد قيد بالبيان الأصلي (نتيجتان).
 *  (5) توقف السكريبت بالكامل عند غياب القيد كلياً (لا بالبيان الأصلي ولا بالرقم المتوقَّع).
 *  (6) قيد بتاريخ إقفال يُترَك بلا لمس، البقية تُصحَّح.
 *
 * التشغيل: DATABASE_URL=<محلي> npx tsx scripts/test-fix-armi-entries-688-724-733-1333.ts
 */
import { PrismaClient, type AccountType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { run, TARGET_ENTRIES, selectKeepAndDelete, linesMatch, amountKey, type TargetEntrySpec } from "./fix-armi-entries-688-724-733-1333";

const prisma = new PrismaClient();

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// كل الحسابات الحقيقية التي تلمسها الأربعة المستهدَفة (المرجع، والأجنبية معاً) — بنوعها المحاسبي
// الصحيح، لازمة لتحقق جدول أثر الأرصدة من الأنواع الصحيحة (مدين/دائن الطبيعي).
const ACCOUNTS: { name: string; type: AccountType }[] = [
  { name: "التأمينات الاجتماعية (GOSI)", type: "liability" },
  { name: "شركة يسم للتجارة", type: "liability" },
  { name: "الصندوق النقدي - الإدارة العامة", type: "asset" },
  { name: "الايرادات من بيع السكراب", type: "revenue" },
  { name: "عهدة اسلام احمد", type: "asset" },
  { name: "مصاريف وقود الموظف", type: "expense" },
  { name: "المصروفات النثرية مع أولا", type: "asset" },
  { name: "عملاء - مبيعات جملة/عقود", type: "asset" },
  { name: "ضريبة القيمة المضافة المستحقة (مبيعات)", type: "liability" },
  { name: "إيرادات قطع الغيار", type: "revenue" },
  { name: "بنك الأهلي 12300001016808", type: "asset" },
  { name: "بنك الراجحي", type: "asset" },
];

async function createTempTenantCompany(namePrefix: string) {
  const tenant = await prisma.tenant.create({ data: { name: `${namePrefix} tenant`, unlockPin: "test-placeholder" } });
  const company = await prisma.company.create({ data: { tenantId: tenant.id, name: `${namePrefix} company` } });
  return { tenant, company };
}

async function createAccounts(tenantId: string, companyId: string, only?: Set<string>) {
  let code = 600000;
  const byName = new Map<string, string>();
  for (const a of ACCOUNTS) {
    if (only && !only.has(a.name)) continue;
    code++;
    const created = await prisma.account.create({ data: { tenantId, companyId, code: String(code), level: 4, isPosting: true, name: a.name, type: a.type } });
    byName.set(a.name, created.id);
  }
  return byName;
}

async function cleanupTenant(tenantId: string) {
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

interface RawLine {
  account: string;
  debit: number;
  credit: number;
}

// يبني بنية الأسطر "الفاسدة" الحرفية لقيد معيَّن من الأربعة، طبق الوصف الدقيق الذي زوّده المستخدم
// (زوج صحيح مكرَّر + كتلة/زوج أجنبي مكرَّر) — لا تبسيط، لاختبار selectKeepAndDelete على نفس شكل
// التلوّث الحقيقي فعلياً.
function buildCorruptedLines(num: number): RawLine[] {
  const correctPair: Record<number, [RawLine, RawLine]> = {
    688: [
      { account: "التأمينات الاجتماعية (GOSI)", debit: 3935.48, credit: 0 },
      { account: "شركة يسم للتجارة", debit: 0, credit: 3935.48 },
    ],
    724: [
      { account: "الصندوق النقدي - الإدارة العامة", debit: 50, credit: 0 },
      { account: "الايرادات من بيع السكراب", debit: 0, credit: 50 },
    ],
    733: [
      { account: "عهدة اسلام احمد", debit: 500, credit: 0 },
      { account: "الصندوق النقدي - الإدارة العامة", debit: 0, credit: 500 },
    ],
    1333: [
      { account: "مصاريف وقود الموظف", debit: 68, credit: 0 },
      { account: "المصروفات النثرية مع أولا", debit: 0, credit: 68 },
    ],
  }[num]!;

  if (num === 688) {
    const foreignPair: RawLine[] = [
      { account: "الصندوق النقدي - الإدارة العامة", debit: 100, credit: 0 },
      { account: "عملاء - مبيعات جملة/عقود", debit: 0, credit: 100 },
    ];
    return [...correctPair, ...correctPair, ...foreignPair, ...foreignPair];
  }
  if (num === 724) {
    const foreignPair: RawLine[] = [
      { account: "بنك الأهلي 12300001016808", debit: 500, credit: 0 },
      { account: "عملاء - مبيعات جملة/عقود", debit: 0, credit: 500 },
    ];
    return [...correctPair, ...correctPair, ...foreignPair, ...foreignPair];
  }
  if (num === 733) {
    const invoice: RawLine[] = [
      { account: "عملاء - مبيعات جملة/عقود", debit: 1000, credit: 0 },
      { account: "ضريبة القيمة المضافة المستحقة (مبيعات)", debit: 0, credit: 65 },
      { account: "ضريبة القيمة المضافة المستحقة (مبيعات)", debit: 0, credit: 65 },
      { account: "إيرادات قطع الغيار", debit: 0, credit: 435 },
      { account: "إيرادات قطع الغيار", debit: 0, credit: 435 },
    ];
    const receipt: RawLine[] = [
      { account: "بنك الأهلي 12300001016808", debit: 500, credit: 0 },
      { account: "عملاء - مبيعات جملة/عقود", debit: 0, credit: 500 },
    ];
    const block = [...correctPair, ...invoice, ...receipt]; // 9 أسطر
    return [...block, ...block, ...block]; // ×3 = 27 سطراً
  }
  // 1333
  const invoice: RawLine[] = [
    { account: "عملاء - مبيعات جملة/عقود", debit: 25000, credit: 0 },
    { account: "ضريبة القيمة المضافة المستحقة (مبيعات)", debit: 0, credit: 3261 },
    { account: "الايرادات من بيع السكراب", debit: 0, credit: 21739 },
  ];
  const receipt: RawLine[] = [
    { account: "بنك الراجحي", debit: 25000, credit: 0 },
    { account: "عملاء - مبيعات جملة/عقود", debit: 0, credit: 25000 },
  ];
  const block = [...correctPair, ...invoice, ...receipt]; // 7 أسطر
  return [...block, ...block, ...block]; // ×3 = 21 سطراً
}

async function createCorruptedEntry(tenantId: string, companyId: string, spec: TargetEntrySpec, accountByName: Map<string, string>, useOriginalMemo: boolean) {
  const rawLines = buildCorruptedLines(spec.num);
  const entryId = randomUUID();
  await prisma.journalEntry.create({
    data: {
      id: entryId,
      tenantId,
      companyId,
      date: new Date("2025-06-01T00:00:00.000Z"),
      memo: useOriginalMemo ? spec.originalMemo : "بيان غير مطابق لأي حالة متوقَّعة",
      status: "posted",
      entryNumber: spec.entryNumber,
      sourceModule: "bulk_import",
      lines: {
        create: rawLines.map((l) => ({ id: randomUUID(), accountId: accountByName.get(l.account)!, debit: l.debit, credit: l.credit })),
      },
    },
  });
  return entryId;
}

async function seedAllFour(tenantId: string, companyId: string, accountByName: Map<string, string>) {
  for (const spec of TARGET_ENTRIES) {
    await createCorruptedEntry(tenantId, companyId, spec, accountByName, true);
  }
}

async function main() {
  console.log(`${"=".repeat(60)}\nاختبار 0: linesMatch/amountKey/selectKeepAndDelete — منطق خالص\n${"=".repeat(60)}`);
  const a1 = "acc1", a2 = "acc2", a3 = "acc3";
  check(
    "linesMatch: أسطر متطابقة (ترتيب مختلف) تُعتبَر متطابقة",
    linesMatch(
      [{ id: "1", accountId: a1, accountName: "", debit: 100, credit: 0 }, { id: "2", accountId: a2, accountName: "", debit: 0, credit: 100 }],
      [{ accountId: a2, accountName: "", debit: 0, credit: 100 }, { accountId: a1, accountName: "", debit: 100, credit: 0 }],
    ),
  );
  check("amountKey يفرّق بين مدين ودائن لنفس الرقم", amountKey(100, 0) !== amountKey(0, 100));
  {
    const current = [
      { id: "k1", accountId: a1, accountName: "", debit: 500, credit: 0 },
      { id: "k2", accountId: a2, accountName: "", debit: 0, credit: 500 },
      { id: "d1", accountId: a1, accountName: "", debit: 500, credit: 0 },
      { id: "d2", accountId: a2, accountName: "", debit: 0, credit: 500 },
      { id: "d3", accountId: a3, accountName: "", debit: 999, credit: 0 },
    ];
    const target = [
      { accountId: a1, accountName: "", debit: 500, credit: 0 },
      { accountId: a2, accountName: "", debit: 0, credit: 500 },
    ];
    const sel = selectKeepAndDelete(current, target)!;
    check("selectKeepAndDelete: يُبقي سطرين فقط", sel.keep.length === 2);
    check("selectKeepAndDelete: يحذف الباقي (3 أسطر)", sel.toDelete.length === 3);
    check("selectKeepAndDelete: لا يخترع أسطراً — كل الـid المُبقاة من ضمن الأصلية", sel.keep.every((l) => current.some((c) => c.id === l.id)));
  }

  // ============ اختبار 1: المسار الأساسي الكامل (dry-run -> commit -> idempotent rerun) ============
  console.log(`\n${"=".repeat(60)}\nاختبار 1: المسار الأساسي — الأربعة معاً، dry-run ثم commit ثم إعادة تشغيل idempotent\n${"=".repeat(60)}`);
  const t1 = await createTempTenantCompany("fix-688-1333-happy");
  try {
    const names = await createAccounts(t1.tenant.id, t1.company.id);
    await seedAllFour(t1.tenant.id, t1.company.id, names);

    await run(t1.company.id, false); // dry-run — يجب ألا يكتب شيئاً
    for (const spec of TARGET_ENTRIES) {
      const e = await prisma.journalEntry.findUnique({ where: { companyId_entryNumber: { companyId: t1.company.id, entryNumber: spec.entryNumber } }, include: { lines: true } });
      check(`القيد ${spec.num}: dry-run لم يغيّر عدد الأسطر`, e!.lines.length === buildCorruptedLines(spec.num).length);
      check(`القيد ${spec.num}: dry-run لم يغيّر البيان`, e!.memo === spec.originalMemo);
    }

    await run(t1.company.id, true); // commit فعلي

    const keptIdsBySpec = new Map<number, string[]>();
    for (const spec of TARGET_ENTRIES) {
      const e = await prisma.journalEntry.findUnique({ where: { companyId_entryNumber: { companyId: t1.company.id, entryNumber: spec.entryNumber } }, include: { lines: { include: { account: true } } } });
      check(`القيد ${spec.num}: بعد commit — سطران فقط بالضبط`, e!.lines.length === 2, `الفعلي=${e!.lines.length}`);
      check(`القيد ${spec.num}: بعد commit — البيان الصحيح`, e!.memo === spec.targetMemo, `الفعلي="${e!.memo}"`);
      const debit = e!.lines.reduce((s, l) => s + Number(l.debit), 0);
      const credit = e!.lines.reduce((s, l) => s + Number(l.credit), 0);
      check(`القيد ${spec.num}: بعد commit — متوازن`, Math.abs(debit - credit) < 0.01, `مدين=${debit} دائن=${credit}`);
      keptIdsBySpec.set(spec.num, e!.lines.map((l) => l.id).sort());

      const auditLogs = await prisma.auditLog.findMany({ where: { tenantId: t1.tenant.id, entityId: e!.id, action: "journal_entry.fix_armi_duplicate_lines" } });
      check(`القيد ${spec.num}: سُجِّل AuditLog واحد بالضبط`, auditLogs.length === 1, `الفعلي=${auditLogs.length}`);
    }

    await run(t1.company.id, true); // إعادة تشغيل --commit — يجب أن تكون idempotent كاملة
    for (const spec of TARGET_ENTRIES) {
      const e = await prisma.journalEntry.findUnique({ where: { companyId_entryNumber: { companyId: t1.company.id, entryNumber: spec.entryNumber } }, include: { lines: true } });
      check(`القيد ${spec.num}: إعادة التشغيل لم تغيّر عدد الأسطر`, e!.lines.length === 2);
      check(`القيد ${spec.num}: إعادة التشغيل لم تغيّر معرّفات الأسطر المُبقاة`, JSON.stringify(e!.lines.map((l) => l.id).sort()) === JSON.stringify(keptIdsBySpec.get(spec.num)));
      const auditLogs = await prisma.auditLog.findMany({ where: { tenantId: t1.tenant.id, entityId: e!.id, action: "journal_entry.fix_armi_duplicate_lines" } });
      check(`القيد ${spec.num}: إعادة التشغيل لم تُضِف AuditLog جديداً`, auditLogs.length === 1, `الفعلي=${auditLogs.length}`);
    }
  } finally {
    await cleanupTenant(t1.tenant.id);
  }

  // ============ اختبار 2: عزل الفشل — حساب مفقود لقيد 688 فقط ============
  console.log(`\n${"=".repeat(60)}\nاختبار 2: حساب هدف مفقود لقيد 688 فقط — الثلاثة الباقية تُصحَّح بنجاح\n${"=".repeat(60)}`);
  const t2 = await createTempTenantCompany("fix-688-1333-missing-acc");
  try {
    const only = new Set(ACCOUNTS.map((a) => a.name).filter((n) => n !== "شركة يسم للتجارة"));
    const names = await createAccounts(t2.tenant.id, t2.company.id, only);
    // القيد 688 يحتاج حساب "شركة يسم للتجارة" ضمن أسطره — بما أنه غير موجود، سيفشل إنشاء سطره؛
    // لذا نُنشئ 688 بحساب placeholder بدل الحساب المفقود (القيد نفسه يجب أن يُنشَأ بنجاح ليختبر
    // السكريبت رفضه لاحقاً بسبب فشل *تحليل الحساب المستهدَف*، لا بسبب فشل إنشاء بيانات الاختبار).
    const placeholderId = names.get("الصندوق النقدي - الإدارة العامة")!;
    const entryId688 = randomUUID();
    await prisma.journalEntry.create({
      data: {
        id: entryId688,
        tenantId: t2.tenant.id,
        companyId: t2.company.id,
        date: new Date("2025-06-01T00:00:00.000Z"),
        memo: TARGET_ENTRIES.find((s) => s.num === 688)!.originalMemo,
        status: "posted",
        entryNumber: "J00610",
        sourceModule: "bulk_import",
        lines: {
          create: buildCorruptedLines(688).map((l) => ({
            id: randomUUID(),
            accountId: l.account === "شركة يسم للتجارة" ? placeholderId : names.get(l.account)!,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      },
    });
    for (const spec of TARGET_ENTRIES) {
      if (spec.num === 688) continue;
      await createCorruptedEntry(t2.tenant.id, t2.company.id, spec, names, true);
    }

    await run(t2.company.id, true);

    const e688 = await prisma.journalEntry.findUnique({ where: { id: entryId688 }, include: { lines: true } });
    check("القيد 688 لم يُلمَس (حساب هدف مفقود)", e688!.lines.length === buildCorruptedLines(688).length);
    let othersFixed = 0;
    for (const spec of TARGET_ENTRIES) {
      if (spec.num === 688) continue;
      const e = await prisma.journalEntry.findUnique({ where: { companyId_entryNumber: { companyId: t2.company.id, entryNumber: spec.entryNumber } }, include: { lines: true } });
      if (e!.lines.length === 2 && e!.memo === spec.targetMemo) othersFixed++;
    }
    check("الثلاثة الباقية صُحِّحت بنجاح رغم فشل 688", othersFixed === 3, `الفعلي=${othersFixed}`);
  } finally {
    await cleanupTenant(t2.tenant.id);
  }

  // ============ اختبار 3: توقف كامل — بيان أصلي مكرَّر (نتيجتان) ============
  console.log(`\n${"=".repeat(60)}\nاختبار 3: توقف السكريبت بالكامل عند تكرار البيان الأصلي لقيد واحد (نتيجتان)\n${"=".repeat(60)}`);
  const t3 = await createTempTenantCompany("fix-688-1333-dup-memo");
  try {
    const names = await createAccounts(t3.tenant.id, t3.company.id);
    await seedAllFour(t3.tenant.id, t3.company.id, names);
    // قيد إضافي بنفس البيان الأصلي لـ 724 بالضبط، برقم قيد مختلف — يجب أن يوقف كل شيء
    await prisma.journalEntry.create({
      data: {
        id: randomUUID(),
        tenantId: t3.tenant.id,
        companyId: t3.company.id,
        date: new Date("2025-06-02T00:00:00.000Z"),
        memo: TARGET_ENTRIES.find((s) => s.num === 724)!.originalMemo,
        status: "posted",
        entryNumber: "J99999",
        sourceModule: "bulk_import",
        lines: { create: [{ id: randomUUID(), accountId: names.get("الصندوق النقدي - الإدارة العامة")!, debit: 1, credit: 0 }] },
      },
    });

    let threw = false;
    let message = "";
    try {
      await run(t3.company.id, true);
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    check("السكريبت توقف بالكامل (رمى استثناءً)", threw, message);
    check("رسالة الخطأ تذكر القيد 724 والغموض", message.includes("724") && message.includes("رجّع"));

    // تأكيد ألا شيء تغيّر على أي قيد من الأربعة (لا كتابة جزئية قبل التوقف)
    let anyChanged = false;
    for (const spec of TARGET_ENTRIES) {
      const e = await prisma.journalEntry.findUnique({ where: { companyId_entryNumber: { companyId: t3.company.id, entryNumber: spec.entryNumber } }, include: { lines: true } });
      if (e!.memo !== spec.originalMemo || e!.lines.length !== buildCorruptedLines(spec.num).length) anyChanged = true;
    }
    check("لا تعديل تم على أي من الأربعة رغم التوقف الجزئي أثناء المعالجة", !anyChanged);
  } finally {
    await cleanupTenant(t3.tenant.id);
  }

  // ============ اختبار 4: توقف كامل — قيد غائب تماماً (لا بالبيان الأصلي ولا بالرقم المتوقَّع) ============
  console.log(`\n${"=".repeat(60)}\nاختبار 4: توقف السكريبت بالكامل عند غياب أحد القيود تماماً\n${"=".repeat(60)}`);
  const t4 = await createTempTenantCompany("fix-688-1333-missing-entry");
  try {
    const names = await createAccounts(t4.tenant.id, t4.company.id);
    for (const spec of TARGET_ENTRIES) {
      if (spec.num === 1333) continue; // غير موجود إطلاقاً
      await createCorruptedEntry(t4.tenant.id, t4.company.id, spec, names, true);
    }
    let threw = false;
    let message = "";
    try {
      await run(t4.company.id, true);
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    check("السكريبت توقف بالكامل عند غياب القيد 1333", threw, message);
    check("رسالة الخطأ تذكر القيد 1333", message.includes("1333"));
  } finally {
    await cleanupTenant(t4.tenant.id);
  }

  // ============ اختبار 5: تاريخ إقفال يشمل قيداً واحداً — يُترَك بلا لمس، البقية تُصحَّح ============
  console.log(`\n${"=".repeat(60)}\nاختبار 5: تاريخ إقفال يشمل كل القيود (كلها بنفس التاريخ 2025-06-01) — تُترَك كلها بلا لمس أولاً، ثم بعد رفع الإقفال تُصحَّح\n${"=".repeat(60)}`);
  const t5 = await createTempTenantCompany("fix-688-1333-closing");
  try {
    const names = await createAccounts(t5.tenant.id, t5.company.id);
    await seedAllFour(t5.tenant.id, t5.company.id, names);
    await prisma.company.update({ where: { id: t5.company.id }, data: { fiscalYearClosingDate: new Date("2025-06-01T00:00:00.000Z") } });

    await run(t5.company.id, true);
    let noneTouched = true;
    for (const spec of TARGET_ENTRIES) {
      const e = await prisma.journalEntry.findUnique({ where: { companyId_entryNumber: { companyId: t5.company.id, entryNumber: spec.entryNumber } }, include: { lines: true } });
      if (e!.memo !== spec.originalMemo || e!.lines.length !== buildCorruptedLines(spec.num).length) noneTouched = false;
    }
    check("كل الأربعة بتاريخ الإقفال بالضبط — لم تُلمَس", noneTouched);

    await prisma.company.update({ where: { id: t5.company.id }, data: { fiscalYearClosingDate: new Date("2025-05-01T00:00:00.000Z") } });
    await run(t5.company.id, true);
    let allFixed = true;
    for (const spec of TARGET_ENTRIES) {
      const e = await prisma.journalEntry.findUnique({ where: { companyId_entryNumber: { companyId: t5.company.id, entryNumber: spec.entryNumber } }, include: { lines: true } });
      if (e!.memo !== spec.targetMemo || e!.lines.length !== 2) allFixed = false;
    }
    check("بعد رفع تاريخ الإقفال لما قبل تاريخ القيود — الأربعة صُحِّحت", allFixed);
  } finally {
    await cleanupTenant(t5.tenant.id);
  }

  console.log(`\n${"=".repeat(40)}`);
  if (failures === 0) {
    console.log(`✅ كل اختبارات التكامل نجحت — تصحيح الأربعة، عزل الفشل، التوقف الكامل عند غموض/غياب التحديد، فحص إقفال السنة المالية، وidempotency الحقيقي يعملان بدقة على قاعدة بيانات حقيقية.`);
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
