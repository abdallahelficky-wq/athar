-- سكربت قراءة فقط (read-only) — SELECT فقط، بلا أي INSERT/UPDATE/DELETE.
-- بديل بديل بـ SQL خام لمن يفضّل psql مباشرة بدل تشغيل سكربت Prisma (export-armi-accounts.ts).
--
-- الاستخدام:
--   psql "$DATABASE_URL" -f scripts/export-armi-accounts.sql
-- أو لتصدير النتيجة كـ CSV مباشرة:
--   psql "$DATABASE_URL" -c "\copy ($(cat scripts/export-armi-accounts.sql | tr '\n' ' ')) TO 'armi_accounts.csv' WITH CSV HEADER"

SELECT
  a.code,
  a.name,
  a."nameEn",
  a.level,
  a.type,
  a."isPosting",
  a."isArchived",
  a."isActive",
  a."isBankOrCash",
  p.code  AS "parentCode",
  p.name  AS "parentName",
  c.name  AS "companyName",
  c.id    AS "companyId",
  c."tenantId"
FROM accounts a
JOIN companies c ON c.id = a."companyId"
LEFT JOIN accounts p ON p.id = a."parentId"
WHERE c.name ILIKE '%ارمي%'
ORDER BY c.id, a.code;
