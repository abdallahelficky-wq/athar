-- Read-only inventory for the explicitly designated company administrator.
-- Groups and joins use IDs, never company names. Counts are not permission grants.
-- This is an initial inventory, NOT authorization to move data: attachments,
-- tenant-only settings, shared positions and cross-company references still need review.
WITH scope AS (
  SELECT DISTINCT u."tenantId"
  FROM users u JOIN identities i ON i.id = u."identityId"
  WHERE lower(i.email) = 'asf@tismpro.sa' AND u.active = true
    AND u."deletedAt" IS NULL AND u."inviteStatus" = 'accepted'
    AND u.role IN ('admin', 'super_admin')
), selected AS (
  SELECT c.id, c."tenantId", c.name, t.code
  FROM companies c JOIN tenants t ON t.id = c."tenantId"
  JOIN scope s ON s."tenantId" = c."tenantId"
)
SELECT c.id AS "companyId", c."tenantId", c.code AS "groupCode", c.name,
  (SELECT count(*) FROM journal_entries j WHERE j."tenantId"=c."tenantId" AND j."companyId"=c.id) AS journals,
  (SELECT count(*) FROM sales_invoices x WHERE x."tenantId"=c."tenantId" AND x."companyId"=c.id) AS sales,
  (SELECT count(*) FROM purchase_invoices x WHERE x."tenantId"=c."tenantId" AND x."companyId"=c.id) AS purchases,
  (SELECT count(*) FROM accounts a WHERE a."tenantId"=c."tenantId" AND a."companyId"=c.id AND a."intercompanyCompanyId" IS NOT NULL) AS "intercompanyAccounts",
  (SELECT count(*) FROM journal_entries j WHERE j."tenantId"=c."tenantId" AND j."companyId"=c.id AND j."mirrorEntryId" IS NOT NULL) AS "mirrorEntries",
  (SELECT count(*) FROM journal_entries j JOIN journal_entries r ON r.id=j."reversalOfEntryId" WHERE j."tenantId"=c."tenantId" AND j."companyId"=c.id AND (r."companyId"<>c.id OR r."tenantId"<>c."tenantId")) AS "crossCompanyReversals",
  (SELECT count(*) FROM users u WHERE u."tenantId"=c."tenantId" AND u."deletedAt" IS NULL AND u."companyScope"='all') AS "sharedUsers"
FROM selected c ORDER BY c."tenantId", c.id;
