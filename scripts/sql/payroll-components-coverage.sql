-- أي الشركات ما زالت تحسب رواتبها ببنود النظام القديم المبنية على أسماء الحسابات (بلا بنود محفوظة) — للقراءة فقط.
--   persisted_components — بنود رواتب محفوظة للشركة (0 = المسار القديم بالأسماء)
--   system_components    — منها بنود نظامية (مهاجَرة من النظام القديم بسكربت backfillPayrollComponents)
--   employees / payroll_runs — هل للمسار أثر فعلي في هذه الشركة
SELECT t.name AS tenant, c.name AS company, c.id AS company_id,
       (SELECT COUNT(*) FROM payroll_components p WHERE p."companyId" = c.id)                   AS persisted_components,
       (SELECT COUNT(*) FROM payroll_components p WHERE p."companyId" = c.id AND p."isSystem")  AS system_components,
       (SELECT COUNT(*) FROM employees e WHERE e."companyId" = c.id)                            AS employees,
       (SELECT COUNT(*) FROM payroll_runs r WHERE r."companyId" = c.id)                         AS payroll_runs
FROM companies c
JOIN tenants t ON t.id = c."tenantId"
ORDER BY (SELECT COUNT(*) FROM payroll_components p WHERE p."companyId" = c.id) = 0 DESC, t.name, c.name;
