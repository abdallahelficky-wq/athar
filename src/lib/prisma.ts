import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

// النوع المُصدَّر هو PrismaClient العادي عمداً: كل دالة في المستودع تستقبل prisma كـ TransactionClient
// تبقى كما هي بلا أي تعديل. الإخفاء (omit) أدناه يسري وقت التشغيل على كل استعلام؛ أي كود يقرأ
// employee.pinHash دون omit: { pinHash: false } صريح يحصل على undefined، فيُعامَل كـ "لا PIN" ويُرفض
// الدخول — فشل آمن، لا تسريب.
export const prisma = new PrismaClient({
  log: env.nodeEnv === "development" ? ["warn", "error"] : ["error"],
  // تجزئة PIN بوابة الموظف لا تخرج من أي استعلام افتراضياً — ولا من أي include متداخل (employee: true
  // في الإجازات/الإجراءات/المخالصات، وبعضها يُخدَم لبوابة الموظف نفسها). تجزئة bcrypt لرمز من 6 أرقام
  // تُكسَر دون اتصال في ساعات، فتسريبها يُلغي القفل وحدّ المحاولات تماماً. الموضعان اللذان يحتاجانها
  // فعلاً يطلبانها صراحةً بـ omit: { pinHash: false }.
  omit: { employee: { pinHash: true } },
}) as unknown as PrismaClient;
