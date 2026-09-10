/**
 * اختبار تكامل محلي (Prisma حقيقي على قاعدة بيانات محلية) لـ check-armi-all-entry-dates.ts —
 * قبل تشغيله على الإنتاج. يبني قيوداً تجريبية بأرقام مرجعية حقيقية معروفة (688, 724, 733, 1333،
 * وواحداً سليماً كمرجع سلامة: 401) على شركة مؤقتة، بتواريخ صحيحة لبعضها وخاطئة (بنمط الخلل الفعلي:
 * الشهر المخزَّن = يوم المرجع، اليوم المخزَّن = شهر المرجع ناقص 1) لبعضها الآخر، ويتحقق أن السكريبت
 * يكتشف بالضبط الاختلافات المتوقَّعة ولا شيء غيرها.
 *
 * matchEntries() (المُعاد استخدامه هنا) لا يعتمد على اسم الحساب أو تطابق المبلغ لتحديد originalNumber
 * لقيد رقمي — فقط استخراج الرقم من الـmemo — لذا لا حاجة لحسابات أو مبالغ حقيقية في هذا الاختبار،
 * فقط سطر واحد تعسفي بأي قيمة لكل قيد تجريبي.
 *
 * التشغيل: DATABASE_URL=<محلي> npx tsx scripts/test-check-armi-all-entry-dates.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { run } from "./check-armi-all-entry-dates";

const prisma = new PrismaClient();

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// يحاكي فعلياً الخلل المكتشَف في الإنتاج: الشهر المخزَّن = يوم التاريخ الصحيح، اليوم المخزَّن =
// شهر التاريخ الصحيح ناقص 1.
function buggedDate(correctYmd: string): string {
  const [y, m, d] = correctYmd.split("-").map(Number);
  const buggedMonth = d;
  const buggedDay = m - 1;
  return `${y}-${String(buggedMonth).padStart(2, "0")}-${String(buggedDay).padStart(2, "0")}`;
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

async function createEntry(tenantId: string, companyId: string, entryNumber: string, memo: string, date: string, accountId: string) {
  await prisma.journalEntry.create({
    data: {
      id: randomUUID(),
      tenantId,
      companyId,
      date: new Date(`${date}T00:00:00.000Z`),
      memo,
      status: "posted",
      entryNumber,
      sourceModule: "bulk_import",
      lines: { create: [{ id: randomUUID(), accountId, debit: 1, credit: 0 }, { id: randomUUID(), accountId, debit: 0, credit: 1 }] },
    },
  });
}

async function main() {
  console.log(`${"=".repeat(60)}\nاختبار buggedDate() — منطق خالص\n${"=".repeat(60)}`);
  check("buggedDate(2025-11-04) = 2025-04-10 (نفس النمط الفعلي المكتشَف لـ688)", buggedDate("2025-11-04") === "2025-04-10");
  check("buggedDate(2026-04-12) = 2026-12-03 (نفس النمط الفعلي المكتشَف لـ1333)", buggedDate("2026-04-12") === "2026-12-03");

  console.log(`\n${"=".repeat(60)}\nاختبار: اكتشاف اختلافات التاريخ + التنبيه على التواريخ المستقبلية\n${"=".repeat(60)}`);
  const t = await createTempTenantCompany("check-all-dates");
  try {
    const acc = await prisma.account.create({ data: { tenantId: t.tenant.id, companyId: t.company.id, code: "900001", level: 4, isPosting: true, name: "حساب اختبار", type: "expense" } });

    // 401: تاريخ صحيح (2025-09-18) — يجب ألا يظهر كاختلاف
    await createEntry(t.tenant.id, t.company.id, "J00401", "قيد يدوي رقم 401", "2025-09-18", acc.id);
    // 688: تاريخ بالخلل الفعلي المكتشَف (2025-04-10 بدل 2025-11-04) — أيضاً بعد اليوم المرجعي 2026-09-09؟ لا، هذا التاريخ نفسه ليس مستقبلياً
    await createEntry(t.tenant.id, t.company.id, "J00610", "قيد يدوي رقم 688 - أنشئ بواسطة Kashif Ali", buggedDate("2025-11-04"), acc.id);
    // 1333: تاريخ بالخلل الفعلي (2026-12-03 بدل 2026-04-12) — هذا التاريخ الخاطئ نفسه بعد 2026-09-09، فيجب أن يُعلَّم "مستقبلي" أيضاً
    await createEntry(t.tenant.id, t.company.id, "J01311", "قيد يدوي رقم 1333 - أنشئ بواسطة Kashif Ali", buggedDate("2026-04-12"), acc.id);
    // 724: تاريخ صحيح تماماً (2025-12-03) — سليم، لا يجب أن يظهر
    await createEntry(t.tenant.id, t.company.id, "J00711", "قيد يدوي رقم 724 - أنشئ بواسطة Kashif Ali", "2025-12-03", acc.id);
    // قيد إضافي بلا أي علاقة بالمرجع (لا رقم يُستخرَج من البيان) لكن بتاريخ مستقبلي — يجب أن يظهر
    // في تنبيه "تاريخ مستقبلي" فقط، لا في قائمة اختلافات التاريخ (لأنه لا يقابله مرجع أصلاً)
    await createEntry(t.tenant.id, t.company.id, "J09999", "قيد يدوي بلا رقم مرجعي واضح", "2026-12-25", acc.id);

    let output = "";
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
      originalLog(...args);
    };
    try {
      await run(t.company.id);
    } finally {
      console.log = originalLog;
    }

    check("401 (تاريخ صحيح) لا يظهر في قائمة الاختلافات", !output.includes("القيد 401 (entryNumber="));
    check("724 (تاريخ صحيح) لا يظهر في قائمة الاختلافات", !output.includes("القيد 724 (entryNumber="));
    check("688 يظهر كاختلاف بالتاريخين الصحيحين (أثر=2025-04-10 / الصحيح=2025-11-04)", output.includes("القيد 688 (entryNumber=J00610): أثر=2025-04-10 / الصحيح (المرجع)=2025-11-04"));
    check("1333 يظهر كاختلاف بالتاريخين الصحيحين (أثر=2026-12-03 / الصحيح=2026-04-12)", output.includes("القيد 1333 (entryNumber=J01311): أثر=2026-12-03 / الصحيح (المرجع)=2026-04-12"));
    check("1333 (تاريخه الخاطئ نفسه بعد 2026-09-09) يُعلَّم كمستقبلي ضمن سطر الاختلاف", output.includes("القيد 1333") && output.includes("🔮 تاريخ مستقبلي في أثر!") && /القيد 1333[^\n]*🔮/.test(output));
    check("688 (تاريخه الخاطئ ليس بعد 2026-09-09) لا يُعلَّم كمستقبلي", !/القيد 688[^\n]*🔮/.test(output));
    check("الملخص يقول: 2 قيداً باختلاف تاريخ", output.includes("قيود رقمية باختلاف تاريخ: 2"));
    check("قيد J09999 غير المرتبط بمرجع يظهر في تنبيه التاريخ المستقبلي المستقل", output.includes("entryNumber=J09999") && output.includes("تاريخ مستقبلي"));
    check("الملخص يقول: 2 قيداً بتاريخ مستقبلي إجمالاً (1333 + J09999)", output.includes("قيود بتاريخ مستقبلي (من كل الأنماط): 2"));
    check("إجمالي القيود المستورَدة = 5", output.includes("إجمالي القيود المستورَدة فعلياً (sourceModule=bulk_import) في أثر: 5"));
  } finally {
    await cleanupTenant(t.tenant.id);
  }

  console.log(`\n${"=".repeat(40)}`);
  if (failures === 0) {
    console.log(`✅ كل الاختبارات نجحت — اكتشاف اختلافات التاريخ والتنبيه على التواريخ المستقبلية يعملان بدقة على قاعدة بيانات حقيقية.`);
  } else {
    console.log(`❌ فشل ${failures} اختباراً.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
