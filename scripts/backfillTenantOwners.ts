/**
 * تعبئة رجعية لـ Tenant.ownerId للشركات المسجَّلة قبل ميزة نظام صلاحيات المناصب — يملأ كل شركة
 * بلا مالك بأول مستخدم سجَّل لها (orderBy createdAt asc)، بنفس منطق "أول مستخدم = مالك" المستخدم
 * الآن في auth.service.ts (register) لأي شركة جديدة تُسجَّل من الآن فصاعداً.
 *
 * الاستخدام:
 *   npx tsx scripts/backfillTenantOwners.ts             # تقرير Dry-run فقط (لا يعدّل شيئاً)
 *   npx tsx scripts/backfillTenantOwners.ts --commit     # تنفيذ فعلي بعد مراجعة التقرير أعلاه
 *
 * لا يُشغَّل بعلامة --commit على بيانات إنتاج حقيقية إلا بعد عرض تقرير الـ Dry-run على المستخدم
 * وانتظار تأكيده الصريح.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const commit = process.argv.includes("--commit");

async function main() {
  const tenantsWithoutOwner = await prisma.tenant.findMany({
    where: { ownerId: null },
    select: { id: true, name: true },
  });

  if (!tenantsWithoutOwner.length) {
    console.log("✅ كل الشركات لديها بالفعل مالك محدَّد — لا يوجد شيء للتعبئة الرجعية.");
    return;
  }

  console.log(`\n=== تقرير التعبئة الرجعية لمالكي الشركات (${commit ? "تنفيذ فعلي" : "Dry-run — لم يُعدَّل شيء بعد"}) ===\n`);

  const plan: { tenantId: string; tenantName: string; ownerId: string; ownerEmail: string }[] = [];
  for (const tenant of tenantsWithoutOwner) {
    const firstUser = await prisma.user.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    });
    if (!firstUser) {
      console.log(`⚠️  "${tenant.name}" — لا يوجد أي مستخدم مسجَّل لها إطلاقاً، لن يُملأ ownerId (سيبقى null).`);
      continue;
    }
    plan.push({ tenantId: tenant.id, tenantName: tenant.name, ownerId: firstUser.id, ownerEmail: firstUser.email });
    console.log(`"${tenant.name}" → المالك: ${firstUser.email}`);
  }

  console.log(`\nالإجمالي: ${plan.length} شركة سيُملأ لها ownerId.\n`);

  if (!commit) {
    console.log("هذا تقرير فقط — لم يتم تعديل أي بيانات. أعد التشغيل بـ --commit بعد مراجعة الأسماء أعلاه لتنفيذ التعبئة فعلياً.");
    return;
  }

  console.log("جارٍ التنفيذ الفعلي...\n");
  for (const p of plan) {
    await prisma.tenant.update({ where: { id: p.tenantId }, data: { ownerId: p.ownerId } });
    console.log(`  ✅ "${p.tenantName}" — تم ضبط المالك (${p.ownerEmail})`);
  }
  console.log("\n✅ اكتملت التعبئة الرجعية.");
}

main()
  .catch((err) => {
    console.error("خطأ أثناء تنفيذ السكريبت:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
