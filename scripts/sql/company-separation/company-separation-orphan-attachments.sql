-- Read-only recovery of ownership metadata for two orphan attachments. Never reads file names, bytes or financial fields.
WITH targets(attachment_id,entity_id) AS (VALUES
 ('cmt1xk2990009130d2atjkmcn','cmt1xk0an0004130d8whwq453'),
 ('cmtpk5scy0012kclo18agknox','cmtpk5pv2000xkclokyccfhjw'))
SELECT x.attachment_id,a."companyId",a."entityType",a.action,count(*) AS audit_relationship_count
FROM targets x JOIN audit_logs a ON a."entityId"=x.entity_id
WHERE a."tenantId"='cmsrchwg90009e8f5fmj3v59l'
GROUP BY x.attachment_id,a."companyId",a."entityType",a.action
ORDER BY x.attachment_id,a."companyId";
