/**
 * قراءة فقط — لا يكتب أو يعدّل أي شيء إطلاقاً. يسحب شجرة حسابات شركة واحدة بالكامل (كل المستويات
 * وكل الحالات، بما فيها الحسابات المؤرشفة/المعطّلة — عبر GET /accounts?tree=true، نفس المسار
 * الذي يستخدمه fix-account-type.ts) ويطبع جدولاً بكل حساب لا يحمل nameEn بعد، بالإضافة إلى عدد
 * الحسابات التي تحمل nameEn بالفعل وستُستثنى من أي خطوة لاحقة.
 *
 * خطوة استكشاف تسبق كتابة سكريبت التطبيق الفعلي (بنمط fix-account-type.ts: dry-run افتراضي،
 * --commit صريح فقط) — ذلك السكريبت يحتاج معرفة الأسماء العربية الفعلية أولاً لتوليد مقابل
 * إنجليزي دقيق لكل واحد منها، بدل تخمين ترجمات لحسابات لم تُرَ فعلياً.
 *
 * الاستخدام:
 *   ATHAR_API_BASE="https://<production-host>/api" \
 *   ATHAR_EMAIL="..." ATHAR_PASSWORD="..." \
 *   npx tsx scripts/list-armi-accounts-missing-english-name.ts cmsrciyjv000ge8f57p2azqdd
 */

interface Account {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  type: string;
  level: number;
  parentId: string | null;
  isPosting: boolean;
  isActive: boolean;
  isArchived: boolean;
}

const apiBase = process.env.ATHAR_API_BASE;
const email = process.env.ATHAR_EMAIL;
const password = process.env.ATHAR_PASSWORD;

async function main() {
  const [companyId] = process.argv.slice(2);

  if (!apiBase || !email || !password) {
    console.error("مطلوب: ATHAR_API_BASE, ATHAR_EMAIL, ATHAR_PASSWORD كمتغيرات بيئة.");
    process.exit(1);
  }
  if (!companyId) {
    console.error("الاستخدام: npx tsx scripts/list-armi-accounts-missing-english-name.ts <companyId>");
    process.exit(1);
  }

  const loginRes = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    console.error(`فشل تسجيل الدخول (${loginRes.status}):`, await loginRes.text());
    process.exit(1);
  }
  const { accessToken } = await loginRes.json();
  const auth = { Authorization: `Bearer ${accessToken}` };

  // tree=true إلزامي: بدونه GET /accounts يُرجع فقط حسابات الترحيل النشطة (level 4، isPosting،
  // isActive، !isArchived) ويستبعد كل الحسابات التجميعية وأي حساب مؤرشف/معطّل.
  const listRes = await fetch(`${apiBase}/accounts?companyId=${encodeURIComponent(companyId)}&tree=true`, { headers: auth });
  if (!listRes.ok) {
    console.error(`فشل جلب شجرة الحسابات (${listRes.status}):`, await listRes.text());
    process.exit(1);
  }
  const accounts: Account[] = await listRes.json();
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));

  const missing = accounts.filter((a) => !a.nameEn || !a.nameEn.trim());
  const present = accounts.length - missing.length;
  missing.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  console.log(`الشركة: ${companyId}`);
  console.log(`إجمالي الحسابات (كل المستويات وكل الحالات): ${accounts.length}`);
  console.log(`لها nameEn بالفعل (ستُستثنى من أي تعديل لاحقاً): ${present}`);
  console.log(`بلا nameEn (المطلوب توليد اسم إنجليزي لها): ${missing.length}\n`);

  console.log(["code", "level", "type", "posting", "active", "archived", "parentCode", "name"].join("\t"));
  for (const a of missing) {
    console.log(
      [
        a.code,
        a.level,
        a.type,
        a.isPosting,
        a.isActive,
        a.isArchived,
        a.parentId ? (codeById.get(a.parentId) ?? "") : "",
        a.name,
      ].join("\t"),
    );
  }
}

main().catch((err) => {
  console.error("خطأ غير متوقع:", err);
  process.exit(1);
});
