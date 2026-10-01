/**
 * "prisma migrate deploy" عند الإقلاع (سكربت start) — عبر الاتصال المباشر لا مُجمِّع الاتصالات.
 *
 * الترحيل يمسك قفلاً استشارياً على مستوى الجلسة، وعبر مُجمِّع Neon (-pooler) قد يبقى ممسوكاً بعد انتهاء النشر الذي
 * أخذه فيتعطّل كل نشر لاحق بـP1002 (حادثة 2026-09-30، راجع prisma/migrations/README.md). لذلك يُشغَّل الترحيل على
 * DIRECT_URL إن وُجد، ويبقى الخادم نفسه على DATABASE_URL المُجمَّع.
 *
 * يُحمَّل .env أولاً (dotenv لا يستبدل متغيّراً موجوداً في البيئة) ثم يُختار الرابط — اختياره بتوسعة الصدفة في
 * package.json كان يمرّر DATABASE_URL فارغاً لـPrisma حين يكون الرابطان في .env وحده. بلا DIRECT_URL يبقى السلوك كما كان.
 */
require("dotenv").config();
const { spawnSync } = require("child_process");

const env = { ...process.env };
if (env.DIRECT_URL) env.DATABASE_URL = env.DIRECT_URL;

const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
