-- Read-only, administrative relationship metadata only. No document contents or amounts.
-- Scoped by the exact source tenant and its explicitly designated accepted administrator.
WITH scope AS (
 SELECT DISTINCT u."tenantId" FROM users u JOIN identities i ON i.id=u."identityId"
 WHERE u."tenantId"='cmsrchwg90009e8f5fmj3v59l' AND lower(i.email)='asf@tismpro.sa'
 AND u.active AND u."deletedAt" IS NULL AND u."inviteStatus"='accepted' AND u.role IN ('admin','super_admin')
)
SELECT 'membership' AS kind, u.id AS id, u."companyScope" AS scope, u.role::text AS detail, count(*) AS count
FROM users u JOIN scope s ON s."tenantId"=u."tenantId"
GROUP BY u.id,u."companyScope",u.role
UNION ALL
SELECT 'attachment_type',null,null,a."entityType",count(*) FROM attachments a JOIN scope s ON s."tenantId"=a."tenantId" GROUP BY a."entityType"
UNION ALL
SELECT 'positions',null,null,null,count(*) FROM positions p JOIN scope s ON s."tenantId"=p."tenantId"
UNION ALL
SELECT 'job_titles',null,null,null,count(*) FROM job_titles j JOIN scope s ON s."tenantId"=j."tenantId"
UNION ALL
SELECT 'group_report_schedules',null,null,null,count(*) FROM report_schedules r JOIN scope s ON s."tenantId"=r."tenantId" WHERE r."companyId" IS NULL;
