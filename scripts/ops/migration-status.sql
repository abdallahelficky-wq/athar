-- تشخيص تعطّل "prisma migrate deploy" عند الإقلاع — (1) آخر الترحيلات. للقراءة فقط.
-- لا يقرأ أي بيانات مستأجر (جدول _prisma_migrations وحده)، لذلك هو هنا لا في scripts/sql/ التي يفحص اختبارها شركات المستأجرين.
-- finished_at فارغ مع rolled_back_at فارغ = ترحيل بدأ ولم يكتمل، ويمنع كل نشر لاحق حتى يُعالَج.
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, left(logs, 300) AS logs
FROM "_prisma_migrations"
ORDER BY started_at DESC
LIMIT 5
