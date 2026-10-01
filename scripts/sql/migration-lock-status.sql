-- تشخيص تعطّل "prisma migrate deploy" عند الإقلاع (P1002: Timed out trying to acquire a postgres advisory lock) — للقراءة فقط.
-- لا يقرأ أي بيانات مستأجر: جدول _prisma_migrations وجداول النظام pg_locks/pg_stat_activity فقط، فلا تجميع ولا ربط بمستأجر أو شركة.
--
-- (1) آخر الترحيلات: finished_at فارغ مع rolled_back_at فارغ = ترحيل بدأ ولم يكتمل (يمنع كل نشر لاحق حتى يُعالَج).
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, left(logs, 300) AS logs
FROM "_prisma_migrations"
ORDER BY started_at DESC
LIMIT 5;

-- (2) من يمسك قفل Prisma الآن. المفتاح 72707369 ثابت في Prisma لكل "migrate deploy"، وقفل bigint واحد يظهر
--     في pg_locks كـ classid=0 وobjid=المفتاح وobjsubid=1. صف هنا = اتصال (غالباً من نشر سابق عبر مُجمِّع الاتصالات
--     -pooler) أبقى القفل بعد انتهاء صاحبه؛ لا صفوف = القفل حُرِّر ويمكن إعادة النشر.
--     حدّه: يرى اتصالات قاعدة البيانات الحالية فقط، وعلى Neon يُفرَغ كله عند إعادة تشغيل الـcompute.
SELECT l.pid, l.granted, a.usename, a.application_name, a.client_addr, a.state,
       a.backend_start, a.state_change, now() - a.state_change AS idle_for, left(a.query, 120) AS last_query
FROM pg_locks AS l
JOIN pg_stat_activity AS a ON a.pid = l.pid
WHERE l.locktype = 'advisory' AND l.classid = 0 AND l.objid = 72707369 AND l.objsubid = 1
ORDER BY l.granted DESC, a.backend_start;
