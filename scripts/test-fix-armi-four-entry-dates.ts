/**
 * اختبار تكامل محلي (Prisma حقيقي) لـ fix-armi-four-entry-dates.ts — قبل الاقتراب من الإنتاج.
 * ينشئ قيوداً تجريبية على شركة مؤقتة بنفس الـid الداخلي الحرفي المستخدَم في TARGET_DATE_FIXES
 * الحقيقية (Prisma يسمح بفرض id عند الإنشاء)، ليختبر الثوابت الفعلية للسكريبت دون أي تعديل عليها.
 *
 * التشغيل: DATABASE_URL=<محلي> npx tsx scripts/test-fix-armi-four-entry-dates.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { run, TARGET_DATE_FIXES } from "./fix-armi-four-entry-dates";

const prisma = new PrismaClient();

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function createTempTenantCompany(namePrefix: string) {
  const tenant = await prisma.tenant.create({ data: { name: `${namePrefix} tenant`, unlockPin: "test-placeholder" } });
  const company = await prisma.company.create({ data: { tenantId: tenant.id, name: `${namePrefix} company` } });
  return { tenant, company };
}

async function cleanupTenant(tenantId: string) {
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

async function seedTargets(tenantId: string, companyId: string, accountId: string, wrongDateFor: Set<number>) {
  for (const t of TARGET_DATE_FIXES) {
    const isWrong = wrongDateFor.has(t.originalNumber);
    const storedDate = isWrong ? "2020-01-01" : t.newDate;
    await prisma.journalEntry.create({
      data: {
        id: t.id,
        tenantId,
        companyId,
        date: new Date(`${storedDate}T00:00:00.000Z`),
        memo: `English memo for ${t.originalNumber}`,
        status: "posted",
        entryNumber: t.expectedEntryNumber,
        sourceModule: "bulk_import",
        lines: { create: [{ id: randomUUID(), accountId, debit: 1, credit: 0 }, { id: randomUUID(), accountId, debit: 0, credit: 1 }] },
      },
    });
  }
}

async function main() {
  // ============ اختبار 1: المسار الأساسي — dry-run ثم commit ثم idempotent rerun ============
  console.log(`${"=".repeat(60)}\nاختبار 1: المسار الأساسي (كل الأربعة بتاريخ خاطئ) — dry-run ثم commit ثم إعادة تشغيل idempotent\n${"=".repeat(60)}`);
  const t1 = await createTempTenantCompany("fix-four-dates-happy");
  try {
    const acc = await prisma.account.create({ data: { tenantId: t1.tenant.id, companyId: t1.company.id, code: "900001", level: 4, isPosting: true, name: "حساب اختبار", type: "expense" } });
    await seedTargets(t1.tenant.id, t1.company.id, acc.id, new Set(TARGET_DATE_FIXES.map((t) => t.originalNumber)));

    await run(t1.company.id, false); // dry-run
    for (const t of TARGET_DATE_FIXES) {
      const e = await prisma.journalEntry.findUnique({ where: { id: t.id } });
      check(`القيد ${t.originalNumber}: dry-run لم يغيّر التاريخ`, e!.date.toISOString().slice(0, 10) === "2020-01-01");
    }

    await run(t1.company.id, true); // commit
    for (const t of TARGET_DATE_FIXES) {
      const e = await prisma.journalEntry.findUnique({ where: { id: t.id } });
      check(`القيد ${t.originalNumber}: بعد commit — التاريخ الصحيح`, e!.date.toISOString().slice(0, 10) === t.newDate);
      check(`القيد ${t.originalNumber}: البيان لم يُلمَس`, e!.memo === `English memo for ${t.originalNumber}`);
      const logs = await prisma.auditLog.findMany({ where: { tenantId: t1.tenant.id, entityId: t.id, action: "journal_entry.fix_armi_date" } });
      check(`القيد ${t.originalNumber}: سُجِّل AuditLog واحد بالضبط`, logs.length === 1, `الفعلي=${logs.length}`);
    }

    await run(t1.company.id, true); // rerun — idempotent
    for (const t of TARGET_DATE_FIXES) {
      const logs = await prisma.auditLog.findMany({ where: { tenantId: t1.tenant.id, entityId: t.id, action: "journal_entry.fix_armi_date" } });
      check(`القيد ${t.originalNumber}: إعادة التشغيل لم تُضِف AuditLog جديداً`, logs.length === 1, `الفعلي=${logs.length}`);
    }
  } finally {
    await cleanupTenant(t1.tenant.id);
  }

  // ============ اختبار 2: قيد واحد بتاريخ صحيح بالفعل مسبقاً — يُتخطَّى، البقية تُصحَّح ============
  console.log(`\n${"=".repeat(60)}\nاختبار 2: قيد 724 بتاريخ صحيح مسبقاً — يُتخطَّى بصمت، الثلاثة الباقية تُصحَّح\n${"=".repeat(60)}`);
  const t2 = await createTempTenantCompany("fix-four-dates-partial");
  try {
    const acc = await prisma.account.create({ data: { tenantId: t2.tenant.id, companyId: t2.company.id, code: "900001", level: 4, isPosting: true, name: "حساب اختبار", type: "expense" } });
    const wrong = new Set(TARGET_DATE_FIXES.map((t) => t.originalNumber).filter((n) => n !== 724));
    await seedTargets(t2.tenant.id, t2.company.id, acc.id, wrong);

    await run(t2.company.id, true);
    const e724 = await prisma.journalEntry.findUnique({ where: { id: TARGET_DATE_FIXES.find((t) => t.originalNumber === 724)!.id } });
    check("724 بتاريخه الصحيح الأصلي دون أي تعديل إضافي", e724!.date.toISOString().slice(0, 10) === "2025-12-03");
    const logs724 = await prisma.auditLog.findMany({ where: { tenantId: t2.tenant.id, entityId: e724!.id } });
    check("724 لم يُسجَّل له أي AuditLog (لم يُلمَس أصلاً)", logs724.length === 0);
    let othersFixed = 0;
    for (const t of TARGET_DATE_FIXES) {
      if (t.originalNumber === 724) continue;
      const e = await prisma.journalEntry.findUnique({ where: { id: t.id } });
      if (e!.date.toISOString().slice(0, 10) === t.newDate) othersFixed++;
    }
    check("الثلاثة الباقية صُحِّحت بنجاح", othersFixed === 3, `الفعلي=${othersFixed}`);
  } finally {
    await cleanupTenant(t2.tenant.id);
  }

  // ============ اختبار 3: توقف كامل — id غير موجود ============
  console.log(`\n${"=".repeat(60)}\nاختبار 3: توقف السكريبت بالكامل لو تعذّر إيجاد أي من الأربعة بالـid\n${"=".repeat(60)}`);
  const t3 = await createTempTenantCompany("fix-four-dates-missing");
  try {
    // شركة فارغة تماماً بلا أي من القيود الأربعة
    let threw = false;
    let message = "";
    try {
      await run(t3.company.id, true);
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    check("السكريبت توقف بالكامل (رمى استثناءً)", threw);
    check("رسالة الخطأ تذكر الـid المفقود", message.includes(TARGET_DATE_FIXES[0].id));
  } finally {
    await cleanupTenant(t3.tenant.id);
  }

  // ============ اختبار 4: توقف كامل — تاريخ إقفال يشمل أحد التواريخ المستهدَفة ============
  console.log(`\n${"=".repeat(60)}\nاختبار 4: توقف السكريبت بالكامل لو تاريخ إقفال السنة المالية يشمل أحد التواريخ الجديدة المستهدَفة\n${"=".repeat(60)}`);
  const t4 = await createTempTenantCompany("fix-four-dates-closing");
  try {
    const acc = await prisma.account.create({ data: { tenantId: t4.tenant.id, companyId: t4.company.id, code: "900001", level: 4, isPosting: true, name: "حساب اختبار", type: "expense" } });
    await seedTargets(t4.tenant.id, t4.company.id, acc.id, new Set(TARGET_DATE_FIXES.map((t) => t.originalNumber)));
    // إقفال يشمل تاريخ 688 الجديد (2025-11-04) لكن ليس البقية (كلها بعده باستثناء لا شيء قبله)
    await prisma.company.update({ where: { id: t4.company.id }, data: { fiscalYearClosingDate: new Date("2025-11-04T00:00:00.000Z") } });

    let threw = false;
    let message = "";
    try {
      await run(t4.company.id, true);
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    check("السكريبت توقف بالكامل عند إقفال يشمل تاريخاً مستهدَفاً", threw);
    check("رسالة الخطأ تذكر القيد 688 وسنة الإقفال 2025", message.includes("688") && message.includes("2025"));

    // تأكيد ألا شيء تغيّر على أي قيد
    let anyChanged = false;
    for (const t of TARGET_DATE_FIXES) {
      const e = await prisma.journalEntry.findUnique({ where: { id: t.id } });
      if (e!.date.toISOString().slice(0, 10) !== "2020-01-01") anyChanged = true;
    }
    check("لا تعديل تم على أي قيد رغم التوقف", !anyChanged);
  } finally {
    await cleanupTenant(t4.tenant.id);
  }

  console.log(`\n${"=".repeat(40)}`);
  if (failures === 0) {
    console.log(`✅ كل الاختبارات نجحت — تصحيح التاريخ، idempotency، عزل القيد الصحيح مسبقاً، والتوقف الكامل عند id مفقود أو إقفال سنة مالية تعمل بدقة على قاعدة بيانات حقيقية.`);
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
