/**
 * سكريبت تصحيح تاريخ للقيود الأربعة فقط (688, 724, 733, 1333) — المصحَّحة أسطرها وبياناتها
 * سابقاً عبر fix-armi-entries-688-724-733-1333.ts، والتي كشف الفحص الشامل
 * (check-armi-all-entry-dates.ts، 1,800 قيد رقمي فُحص، صفر اختلاف عدا هذه الأربعة) أن تاريخها
 * المخزَّن في أثر خاطئ فعلياً (لا مجرد عرض)، بنمط ثابت: الشهر المخزَّن = يوم المرجع، اليوم
 * المخزَّن = شهر المرجع ناقص 1.
 *
 * **يستهدف القيود بالـid الداخلي مباشرة** لا بمطابقة البيان — لأن البيان لم يعد يحمل رقم قيود
 * الأصلي بعد تصحيح fix-armi-entries-688-724-733-1333.ts السابق له (استُبدل بالوصف الإنجليزي
 * الحقيقي). الأربعة معروفة ومؤكَّدة يدوياً بالـid وتاريخها الصحيح.
 *
 * **يلمس حقل التاريخ فقط** — لا البيان ولا الأسطر ولا أي حقل آخر، وهذا خارج نطاقه كلياً بعد أن
 * صحَّحها السكريبت السابق بالفعل.
 *
 * قاعدة صارمة: لو تعذّر إيجاد أي قيد من الأربعة بالـid المحدَّد (يجب ألا يحدث، لكنه فحص دفاعي
 * لأربعة قيود معروفة بدقة)، أو وقع أي تاريخ جديد مستهدَف في أو قبل تاريخ إقفال السنة المالية
 * المضبوط للشركة — يتوقف تنفيذ السكريبت **بالكامل فوراً**، ويُطبَع السبب بالتفصيل (بما في ذلك
 * سنة تاريخ الإقفال المخالِف)، ولا يُكتَب أي شيء على أي قيد.
 *
 * Idempotency: أي قيد تاريخه الحالي مطابق للتاريخ المستهدَف بالفعل يُتخطَّى بصمت (لا كتابة غير
 * ضرورية). كل قيد يُصحَّح في معاملة Prisma مستقلة تماماً (rollback تلقائي عند أي فشل)، وكل تصحيح
 * فعلي يُسجَّل في AuditLog (action="journal_entry.fix_armi_date").
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/fix-armi-four-entry-dates.ts [companyId] [--commit]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";

export interface TargetDateFix {
  id: string;
  originalNumber: number;
  expectedEntryNumber: string;
  newDate: string; // YYYY-MM-DD — التاريخ الصحيح المؤكَّد يدوياً من المرجع
}

export const TARGET_DATE_FIXES: TargetDateFix[] = [
  { id: "58a0c0c8-fe9d-4750-a2a7-66a36f8ded9a", originalNumber: 688, expectedEntryNumber: "J00610", newDate: "2025-11-04" },
  { id: "3c76dc8b-7476-4f39-850a-4297ddd3cc50", originalNumber: 724, expectedEntryNumber: "J00711", newDate: "2025-12-03" },
  { id: "2ae7b23a-1595-4619-83dd-cb6740aeb27d", originalNumber: 733, expectedEntryNumber: "J00723", newDate: "2025-12-05" },
  { id: "a0a3e9be-db13-42db-97ef-98d184b0bb2b", originalNumber: 1333, expectedEntryNumber: "J01311", newDate: "2026-04-12" },
];

interface PreparedFix {
  target: TargetDateFix;
  entryNumber: string;
  memo: string | null;
  currentDate: string;
  alreadyCorrect: boolean;
}

export async function run(companyId: string, commit: boolean) {
  console.log(`=== تصحيح تاريخ أربعة قيود أرمي (688, 724, 733, 1333) — companyId=${companyId} ${commit ? "(--commit: سيُنفَّذ فعلياً)" : "(Dry-run، بلا أي كتابة)"} ===\n`);

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, tenantId: true, fiscalYearClosingDate: true } });
  if (!company) throw new Error(`الشركة غير موجودة: ${companyId}`);

  const prepared: PreparedFix[] = [];

  for (const target of TARGET_DATE_FIXES) {
    const entry = await prisma.journalEntry.findUnique({ where: { id: target.id }, select: { id: true, companyId: true, entryNumber: true, memo: true, date: true } });
    if (!entry) {
      throw new Error(
        `🛑 توقف تنفيذ السكريبت بالكامل — لا تعديل تم على أي قيد: لم يُعثَر على أي قيد بالـid المحدَّد "${target.id}" (القيد الأصلي ${target.originalNumber}, entryNumber المتوقَّع ${target.expectedEntryNumber}). راجع يدوياً قبل أي محاولة أخرى.`,
      );
    }
    if (entry.companyId !== companyId) {
      throw new Error(
        `🛑 توقف تنفيذ السكريبت بالكامل — لا تعديل تم على أي قيد: القيد بالـid "${target.id}" ينتمي لشركة مختلفة (${entry.companyId})، لا للشركة المستهدَفة (${companyId}). راجع يدوياً.`,
      );
    }
    if (entry.entryNumber !== target.expectedEntryNumber) {
      throw new Error(
        `🛑 توقف تنفيذ السكريبت بالكامل — لا تعديل تم على أي قيد: القيد بالـid "${target.id}" رقمه الفعلي "${entry.entryNumber}"، لا يطابق المتوقَّع "${target.expectedEntryNumber}" للقيد الأصلي ${target.originalNumber}. راجع يدوياً — قد يكون الـid خاطئاً.`,
      );
    }

    const currentDate = entry.date.toISOString().slice(0, 10);
    prepared.push({
      target,
      entryNumber: entry.entryNumber,
      memo: entry.memo,
      currentDate,
      alreadyCorrect: currentDate === target.newDate,
    });
  }

  const closingDate = company.fiscalYearClosingDate;
  if (closingDate) {
    const violating = prepared.filter((p) => !p.alreadyCorrect && new Date(`${p.target.newDate}T00:00:00.000Z`).getTime() <= closingDate.getTime());
    if (violating.length) {
      throw new Error(
        `🛑 توقف تنفيذ السكريبت بالكامل — لا تعديل تم على أي قيد: ${violating.length} تاريخاً مستهدَفاً يقع في أو قبل تاريخ إقفال السنة المالية (${closingDate.toISOString().slice(0, 10)}، السنة ${closingDate.getUTCFullYear()}): ${violating.map((p) => `القيد ${p.target.originalNumber} -> ${p.target.newDate}`).join(", ")}. راجع يدوياً قبل أي محاولة أخرى.`,
      );
    }
  }

  const alreadyCorrect = prepared.filter((p) => p.alreadyCorrect);
  const needsFix = prepared.filter((p) => !p.alreadyCorrect);

  if (alreadyCorrect.length) {
    console.log(`✅ ${alreadyCorrect.length} قيداً بتاريخه صحيح بالفعل (لا حاجة لأي تعديل):`);
    alreadyCorrect.forEach((p) => console.log(`  القيد ${p.target.originalNumber} (entryNumber=${p.entryNumber}, id=${p.target.id}) — التاريخ=${p.currentDate}`));
    console.log();
  }

  console.log(`=== ${commit ? "سيُنفَّذ الآن" : "Dry-run — تفصيل ما سيُصحَّح"}: ${needsFix.length} قيداً ===\n`);
  needsFix.forEach((p) => {
    console.log(`--- القيد الأصلي رقم ${p.target.originalNumber} (entryNumber=${p.entryNumber}, id=${p.target.id}) ---`);
    console.log(`  البيان الحالي: "${p.memo}"`);
    console.log(`  التاريخ الحالي: ${p.currentDate}`);
    console.log(`  التاريخ الجديد: ${p.target.newDate}`);
    console.log();
  });

  if (!commit) {
    console.log(`(وضع Dry-run — لم يُكتَب أي شيء. أعد التشغيل بإضافة --commit للتنفيذ الفعلي بعد المراجعة والموافقة الصريحة.)`);
    return;
  }

  if (needsFix.length === 0) {
    console.log(`لا شيء يحتاج تصحيحاً — كل القيود الأربعة بتاريخها الصحيح بالفعل.`);
    return;
  }

  console.log(`--commit مفعَّل: تصحيح ${needsFix.length} قيداً فعلياً الآن، كل قيد في معاملة مستقلة...`);
  let succeeded = 0;
  const failed: { originalNumber: number; error: string }[] = [];
  for (const p of needsFix) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.journalEntry.update({ where: { id: p.target.id }, data: { date: new Date(`${p.target.newDate}T00:00:00.000Z`) } });
        await tx.auditLog.create({
          data: {
            tenantId: company.tenantId,
            userId: null,
            action: "journal_entry.fix_armi_date",
            entityType: "JournalEntry",
            entityId: p.target.id,
            metadata: {
              scriptName: "fix-armi-four-entry-dates",
              originalNumber: p.target.originalNumber,
              entryNumber: p.entryNumber,
              previousDate: p.currentDate,
              newDate: p.target.newDate,
            },
          },
        });
      });
      succeeded++;
      console.log(`  ✅ القيد ${p.target.originalNumber} صُحِّح بنجاح (${p.currentDate} -> ${p.target.newDate}).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ originalNumber: p.target.originalNumber, error: message });
      console.log(`  ❌ القيد ${p.target.originalNumber} فشل: ${message}`);
    }
  }

  console.log(`\nتم بنجاح: ${succeeded} قيداً من ${needsFix.length}.`);
  if (failed.length) {
    console.log(`⚠️ فشل ${failed.length} قيداً — أعد تشغيل نفس الأمر لإعادة محاولتها فقط (القيود الناجحة الأخرى لن تتأثر):`);
    failed.forEach((f) => console.log(`  القيد ${f.originalNumber}: ${f.error}`));
  }
  console.log(`\nأعد تشغيل هذا الأمر (بأي وضع) للتأكد من idempotency — يجب أن يُظهر أن كل هذه القيود بتاريخها الصحيح بالفعل الآن.`);
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
