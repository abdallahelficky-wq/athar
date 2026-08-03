/**
 * سكربت قراءة فقط (read-only) — لا يعدّل أي بيانات.
 * يبحث عن أي أثر لتسجيل "نص متسجّل" بسبب مهلة معاملة Prisma (P2028) التي كانت تحدث في
 * auth.service.ts::register() عند زرع الشجرة القياسية (185 حساباً) بحلقة create() فردية.
 *
 * ملاحظة مهمة: معاملة Prisma التفاعلية (interactive $transaction) ذرّية بالكامل — أي خطأ يُلقى
 * داخلها (كخطأ المهلة هذا بالضبط) يتراجع عن كل ما حدث ضمنها تلقائياً، بما في ذلك إنشاء
 * الـ Tenant والـ User اللذين سبق إنشاؤهما في نفس الاستدعاء. لذا من المتوقع نظرياً ألا يترك هذا
 * الخلل الأصلي أي بيانات ناقصة على الإطلاق — هذا السكربت للتأكد الفعلي من ذلك، لا لأنه متوقع أن
 * يجد شيئاً.
 *
 * الاستخدام:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/check-incomplete-registrations.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, createdAt: true },
  });
  console.log(`إجمالي عدد المستأجرين (Tenants): ${tenants.length}`);

  const problems: Array<Record<string, unknown>> = [];

  for (const tenant of tenants) {
    const [accountCount, userCount] = await Promise.all([
      prisma.account.count({ where: { tenantId: tenant.id, companyId: null } }),
      prisma.user.count({ where: { tenantId: tenant.id } }),
    ]);

    // لا نتحقق من عدد ثابت للحسابات (327 ثم 208/210 ثم 185 عبر إصدارات مختلفة من القالب على
    // مدار الجلسة) لأن كل تلك القيم "كاملة" وصحيحة حسب وقت إنشاء المستأجر. الإشارة الحقيقية
    // لخلل "تسجيل نص متسجّل" هي وجود مستأجر بلا أي مستخدم إطلاقاً أو بلا أي حساب إطلاقاً — وهذا
    // لا يفترض أن يحدث أصلاً بما أن معاملة Prisma التفاعلية ذرّية (أي خطأ يتراجع عن كل شيء ضمنها،
    // بما فيه إنشاء المستأجر نفسه)، لكن نتحقق فعلياً بدل الافتراض.
    if (accountCount === 0 || userCount === 0) {
      problems.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        createdAt: tenant.createdAt,
        groupAccountCount: accountCount,
        userCount,
      });
    }
  }

  if (problems.length === 0) {
    console.log("✅ لم يتم العثور على أي مستأجر بشجرة حسابات ناقصة أو بدون مستخدمين — لا توجد بيانات ناقصة من هذا الخلل.");
  } else {
    console.log(`⚠️  تم العثور على ${problems.length} مستأجر(ين) بحالة غير متوقعة:`);
    console.log(problems);
  }
}

main()
  .catch((err) => {
    console.error("خطأ أثناء تنفيذ الفحص:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
