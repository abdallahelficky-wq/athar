/**
 * حارس بيئة إلزامي لأي سكريبت بذرة/تنظيف يكتب مباشرة على DATABASE_URL — يرفض التشغيل ما لم يكن
 * الرابط يشير بوضوح لقاعدة تطوير محلية (المضيف localhost/127.0.0.1، أو اسم القاعدة athar_dev)،
 * حتى لا يكتب أي سكريبت بيانات تجريبية بالخطأ على قاعدة إنتاجية حقيقية (مثال: Neon). يمكن تجاوزه
 * فقط بتمرير --i-know-what-im-doing صراحة في سطر الأوامر — لا أي طريقة أخرى، ولا افتراضياً أبداً.
 *
 * يجب استدعاؤه قبل إنشاء أي PrismaClient في السكريبت المستدعي (وإن كانت PrismaClient نفسها لا
 * تتصل فعلياً إلا عند أول استعلام، فهذا دفاع إضافي: لو رُفض التشغيل هنا، لا ينفَّذ أي سطر لاحق
 * إطلاقاً في ذلك السكريبت).
 */
export const LOCAL_DB_OVERRIDE_FLAG = "--i-know-what-im-doing";

/** آرغيومنتات سطر الأوامر الفعلية (بلا node/مسار السكريبت وبلا علم التجاوز نفسه) — يستخدمها كل من
 * السكريبتين لاستخراج آرغيوماتهما الموضعية (مثل companyId) بصرف النظر عن مكان العلم في السطر. */
export function positionalArgs(): string[] {
  return process.argv.slice(2).filter((arg) => arg !== LOCAL_DB_OVERRIDE_FLAG);
}

export function assertLocalDevDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL غير مضبوط إطلاقاً — لا يمكن التحقق من أنها قاعدة تطوير محلية. اضبطه أولاً.");
    process.exit(1);
  }

  const override = process.argv.includes(LOCAL_DB_OVERRIDE_FLAG);

  let isLocal: boolean;
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname.toLowerCase();
    const dbName = url.pathname.replace(/^\//, "");
    isLocal = host === "localhost" || host === "127.0.0.1" || dbName === "athar_dev";
  } catch {
    // رابط غير قابل لتحليله كـ URL على الإطلاق — يُعامَل كغير محلي (رفض آمن بدل تخمين).
    isLocal = false;
  }

  if (isLocal) return;

  if (override) {
    console.warn(
      `تحذير: تشغيل بتجاوز صريح (${LOCAL_DB_OVERRIDE_FLAG}) على رابط لا يبدو قاعدة تطوير محلية — ` +
        "على مسؤوليتك الكاملة.",
    );
    return;
  }

  console.error(
    "رُفض التشغيل: DATABASE_URL لا يبدو رابط قاعدة تطوير محلية (لا localhost/127.0.0.1 في المضيف، ولا athar_dev " +
      "اسماً لقاعدة البيانات). هذا السكريبت يكتب/يحذف بيانات مباشرة، ولا يجوز تشغيله على قاعدة حقيقية بالخطأ.\n" +
      `لتجاوز هذا الفحص عمداً (على مسؤوليتك الكاملة)، أضف ${LOCAL_DB_OVERRIDE_FLAG} لسطر الأوامر.`,
  );
  process.exit(1);
}
