-- Read-only relationship metadata. No names, balances, amounts or transaction contents.
SELECT a.id, a."companyId", a."parentId", c."tenantId" AS company_tenant_id,
  (SELECT count(*) FROM journal_entry_lines l WHERE l."accountId"=a.id) AS journal_references,
  (SELECT count(*) FROM accounts child WHERE child."parentId"=a.id) AS child_references
FROM accounts a LEFT JOIN companies c ON c.id=a."companyId"
WHERE a."tenantId"='cmsrchwg90009e8f5fmj3v59l'
  AND (a."companyId" IS NULL OR c."tenantId" IS DISTINCT FROM a."tenantId")
ORDER BY a.id;
