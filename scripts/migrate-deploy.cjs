/**
 * "prisma migrate deploy" عند الإقلاع (سكربت start) — بحيث لا يُبقي قفلٌ عالق الخادمَ متوقفاً.
 *
 * الترحيل يمسك قفلاً استشارياً على مستوى الجلسة (pg_advisory_lock(72707369)). جلسة تموت صاحبتها (حاوية يقتلها
 * Railway أثناء إعادة تشغيل، أو اتصال عبر مُجمِّع -pooler) قد تبقى ممسكة به، فيفشل كل إقلاع بعدها بـP1002 ويتوقف
 * الخادم (حادثتا 2026-09-30 و2026-10-01، راجع prisma/migrations/README.md). لذلك:
 *  1) الترحيل على DIRECT_URL إن وُجد (رابط Neon بلا -pooler)، والخادم يبقى على DATABASE_URL المُجمَّع.
 *  2) "migrate status" أولاً — لا يأخذ القفل. لا ترحيلات معلّقة = لا طلب للقفل أصلاً، فإعادة التشغيل والنشر بلا ترحيل
 *     جديد (أغلب الحالات) لا يتعطّلان بقفل عالق أبداً.
 *  3) عند وجود ترحيل معلّق: تُنهى الجلسات اليتيمة الممسكة بقفل Prisma تحديداً — خاملة (لا تنفّذ شيئاً) منذ أكثر من
 *     MIGRATION_LOCK_STALE_SECONDS (افتراضياً 120). ترحيل يعمل فعلاً حالته "active" فلا يُمَسّ. ثم تُعاد المحاولة عند P1002
 *     حتى مهلة MIGRATION_LOCK_WAIT_SECONDS (افتراضياً حدّ الخمول + 60) — أطول من حدّ الخمول عمداً، فقفلٌ تيتّم للتوّ
 *     (حاوية ماتت قبل ثوانٍ) يصل حدّ الخمول وتجري بعده محاولة تنظيف واحدة على الأقل.
 *
 * يُحمَّل .env أولاً (dotenv لا يستبدل متغيّراً موجوداً) ثم يُختار الرابط. رمز الخروج يُمرَّر: ترحيل فاشل = لا خادم.
 */
require("dotenv").config();
const { spawnSync } = require("child_process");

const PRISMA_CLI = require.resolve("prisma/build/index.js");
const LOCK_KEY = 72707369;
// إعداد غير صالح يوقف الإقلاع (لا خادم بلا ترحيل) بدل أن يتخطّى الترحيل بصمت
function setting(name, fallback, min) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min) {
    console.error(`[migrate] ${name} must be an integer >= ${min} (got "${raw}").`);
    process.exit(1);
  }
  return value;
}
const STALE_SECONDS = setting("MIGRATION_LOCK_STALE_SECONDS", 120, 1);
const WAIT_SECONDS = setting("MIGRATION_LOCK_WAIT_SECONDS", STALE_SECONDS + 60, 0);
const RETRY_WAIT_MS = setting("MIGRATION_LOCK_RETRY_WAIT_MS", 15000, 0);

const env = { ...process.env };
if (env.DIRECT_URL) env.DATABASE_URL = env.DIRECT_URL;

function prisma(args, { input, echo = true } = {}) {
  const r = spawnSync(process.execPath, [PRISMA_CLI, ...args], { env, input, encoding: "utf8" });
  if (echo) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  return { status: r.status ?? 1, output: `${r.stdout || ""}${r.stderr || ""}` };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// (2) لا يأخذ القفل: 0 = القاعدة محدَّثة، غير ذلك = ترحيل معلّق أو خطأ (يتولاه deploy كما كان)
const status = prisma(["migrate", "status"], { echo: false });
if (status.status === 0) {
  console.log("[migrate] Database schema is up to date — skipping migrate deploy (no advisory lock taken).");
  process.exit(0);
}

const RELEASE_STALE_LOCK = `
SELECT pg_terminate_backend(l.pid)
FROM pg_locks AS l
JOIN pg_stat_activity AS a ON a.pid = l.pid
WHERE l.locktype = 'advisory' AND l.classid = 0 AND l.objid = ${LOCK_KEY} AND l.objsubid = 1 AND l.granted
  AND a.pid <> pg_backend_pid()
  AND a.state <> 'active'
  AND a.state_change < now() - interval '${STALE_SECONDS} seconds';
`;

const deadline = Date.now() + WAIT_SECONDS * 1000;
for (let attempt = 1; ; attempt++) {
  // (3) فشل هذه الخطوة لا يوقف شيئاً: deploy بعدها يحاول كما كان
  prisma(["db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], { input: RELEASE_STALE_LOCK, echo: false });
  const deploy = prisma(["migrate", "deploy"]);
  if (deploy.status === 0) process.exit(0);
  const lockBusy = deploy.output.includes("P1002") && deploy.output.includes("advisory lock");
  if (!lockBusy || Date.now() >= deadline) process.exit(deploy.status || 1);
  console.error(`[migrate] Advisory lock busy (attempt ${attempt}); retrying in ${RETRY_WAIT_MS / 1000}s until ${WAIT_SECONDS}s have passed.`);
  sleep(RETRY_WAIT_MS);
}
