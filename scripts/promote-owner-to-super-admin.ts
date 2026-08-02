/**
 * سكربت ترقية حساب المالك الوحيد (abdallah.elficky@gmail.com) إلى دور super_admin.
 *
 * لماذا هذا مطلوب: دور super_admin لا يُمنح إلا تلقائياً عند التسجيل لأول مرة
 * (register() في src/modules/auth/auth.service.ts، بمقارنة البريد بـ OWNER_EMAIL).
 * لا يوجد أي منطق يُعيد فحص/ترقية حساب موجود بالفعل عند تسجيل الدخول أو غيره —
 * فإذا كان الحساب قد أُنشئ قبل إضافة هذا المنطق، يبقى بدور "admin" للأبد ما لم
 * يُعدَّل الصف يدوياً في قاعدة البيانات. هذا هو بالضبط سبب عدم ظهور زرار
 * "تثبيت الشجرة القياسية" رغم تسجيل الخروج والدخول من جديد.
 *
 * ما يفعله هذا السكربت بالضبط:
 *   - يبحث عن مستخدم واحد فقط بالبريد "abdallah.elficky@gmail.com" (بحث غير حساس لحالة الأحرف).
 *   - يطبع بياناته الحالية (id, tenant, role) قبل أي تعديل.
 *   - في وضع المعاينة الافتراضي (بدون --apply): لا يعدّل شيئاً، فقط يعرض ما سيحدث.
 *   - مع --apply: يعدّل عمود role فقط لهذا الصف الواحد إلى super_admin، ثم يطبع الصف
 *     بعد التعديل للتأكيد.
 *   - لا يلمس أي عمود آخر (كلمة المرور، الصلاحيات الأخرى، الشركات، ...) ولا أي مستخدم آخر.
 *   - إن كان الدور بالفعل super_admin، يتوقف دون أي تعديل (عملية آمنة للتكرار).
 *
 * الاستخدام (معاينة فقط، لا يعدّل شيئاً):
 *   DATABASE_URL="<رابط قاعدة بيانات الإنتاج>" npx tsx scripts/promote-owner-to-super-admin.ts
 *
 * الاستخدام (تنفيذ فعلي بعد التأكد من نتيجة المعاينة):
 *   DATABASE_URL="<رابط قاعدة بيانات الإنتاج>" npx tsx scripts/promote-owner-to-super-admin.ts --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TARGET_EMAIL = "abdallah.elficky@gmail.com";
const apply = process.argv.includes("--apply");

async function main() {
  const matches = await prisma.user.findMany({
    where: { email: { equals: TARGET_EMAIL, mode: "insensitive" } },
    select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
  });

  if (matches.length === 0) {
    console.log(`لم يتم العثور على أي مستخدم بالبريد "${TARGET_EMAIL}". لم يتم تعديل أي شيء.`);
    return;
  }
  if (matches.length > 1) {
    console.log(`⚠️  تم العثور على أكثر من مستخدم بهذا البريد (${matches.length}) — إيقاف دون تعديل تجنباً لأي خطأ:`);
    console.log(matches);
    return;
  }

  const user = matches[0];
  console.log("الحالة قبل التنفيذ:");
  console.log(user);

  if (user.role === "super_admin") {
    console.log("✅ الحساب بالفعل بدور super_admin. لا حاجة لأي تعديل.");
    return;
  }

  if (!apply) {
    console.log(`\nوضع المعاينة فقط — لم يتم تعديل أي شيء. سيتم تغيير role من "${user.role}" إلى "super_admin" لهذا المستخدم فقط عند التشغيل مع --apply.`);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: "super_admin" },
    select: { id: true, email: true, name: true, role: true, tenantId: true, active: true, createdAt: true },
  });

  console.log("\nتم التعديل. الحالة بعد التنفيذ:");
  console.log(updated);
}

main()
  .catch((err) => {
    console.error("خطأ أثناء تنفيذ السكربت:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
