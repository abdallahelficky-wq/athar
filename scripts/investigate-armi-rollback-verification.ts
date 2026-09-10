/**
 * سكريبت تحقيق قرائي بحت — ينفّذ استعلامًا واحدًا فقط ويطبع النتيجة، للتأكد بيقين تام من عدم وجود
 * أي تحديث جزئي ناتج عن فشل P2028 (انتهاء مهلة معاملة) في محاولة --commit سابقة على
 * fix-armi-bulk-import-data.ts. لا يكتب ولا يعدّل شيئاً إطلاقاً.
 *
 * المنطق: JournalEntry.updatedAt تُحدَّث تلقائياً (@updatedAt) عند أي update فعلي؛ بما أن كل قيود
 * bulk_import أُنشئت دفعة واحدة أصلاً (updatedAt = createdAt وقتها)، أي قيد لم يُلمَس منذ إنشائه
 * سيبقى updatedAt = createdAt تمامًا. عدد الصفوف حيث الاثنان مختلفان = عدد القيود المتأثرة فعلياً
 * بأي كتابة (سواء ناجحة أو ناتجة عن التزام جزئي مفترَض) — يجب أن يكون صفراً بعد فشل P2028 كامل.
 *
 * الاستخدام:
 *   DATABASE_URL=<...> npx tsx scripts/investigate-armi-rollback-verification.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ARMI_COMPANY_ID = "cmsrciyjv000ge8f57p2azqdd";

async function main() {
  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
    FROM journal_entries
    WHERE "companyId" = ${ARMI_COMPANY_ID}
      AND "sourceModule" = 'bulk_import'
      AND "updatedAt" <> "createdAt"
  `;
  const count = Number(result[0].count);
  console.log(`عدد قيود bulk_import لشركة أرمي التي تغيّر updatedAt عن createdAt (أي لُمست منذ الاستيراد الأصلي): ${count}`);
  console.log(count === 0 ? "✅ صفر — لا يوجد أي أثر لتحديث جزئي، التراجع كان كاملاً كما هو متوقع." : "⚠️ غير صفري — راجع هذه القيود تحديداً قبل أي خطوة أخرى.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
