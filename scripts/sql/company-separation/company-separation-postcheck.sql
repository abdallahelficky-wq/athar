-- Read-only separation verification: IDs, permission metadata and relationship counts only.
SELECT c.id AS company_id,c."tenantId" AS tenant_id,t.code AS account_code,t."ownerId" AS owner_id,
 (SELECT count(*) FROM companies sibling WHERE sibling."tenantId"=c."tenantId") AS companies_in_account,
 (SELECT count(*) FROM users u JOIN identities i ON i.id=u."identityId" WHERE u."tenantId"=c."tenantId"
  AND lower(i.email)='asf@tismpro.sa' AND u.role='admin' AND u."companyScope"=c.id
  AND u.active AND u."deletedAt" IS NULL AND u."inviteStatus"='accepted') AS designated_admin_count,
 (SELECT count(*) FROM audit_logs a WHERE a."tenantId"=c."tenantId" AND a."companyId"=c.id
  AND a.action IN ('company.separated','company.separation_completed')) AS separation_audit_count,
 (SELECT count(*) FROM zatca_document_archive a WHERE a."companyId"=c.id) AS archive_count
FROM companies c JOIN tenants t ON t.id=c."tenantId"
WHERE c.id IN ('cmsrciyjv000ge8f57p2azqdd','cmuhc8l5t00f4qjb6uoe4vxx8','cmuttoi4d000cd4o74anj3ibr')
ORDER BY c.id;
