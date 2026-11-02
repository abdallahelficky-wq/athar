-- ملكية المحطات — للقراءة فقط (SELECT وحده)، صف واحد لكل شركة في كل مستأجر.
--
-- ما يعدّه لكل شركة (بمعرّفها لا باسمها: الاسم فريد داخل المستأجر فقط):
--   station_cost_centers      — مراكز تكلفة مميّزة تظهر على فوهات أو ورديات هذه الشركة
--   cc_tenant_wide            — منها: مركز تكلفة بلا شركة (companyId فارغ، عام للمستأجر)
--   cc_other_company          — منها: مركز تكلفة مملوك لشركة أخرى (خلل ملكية يجب أن يكون صفراً)
--   nozzles_active / nozzles_inactive
--   shifts_<status>           — ورديات غير بذرة (isSeedData=false) لكل حالة
--   seed_shifts               — ورديات البذرة (مستبعدة من كل ما سبق)
--   posted_from / posted_to   — مدى shiftDate للورديات المرحَّلة غير البذرة
--   posted_with_entry         — مرحَّلة ولها journalEntryId فعلاً
--   posted_entry_reversed     — مرحَّلة وقيدها عُكِس لاحقاً (قيد آخر reversalOfEntryId = قيدها)
--   posted_entry_not_posted   — مرحَّلة لكن قيدها الآن ليس posted (فُكّ ترحيله)
-- الحدود: شركة بلا محطات تظهر بأصفار. لا يقرأ أي مبالغ.
WITH cc AS (
  SELECT x."companyId", x."costCenterId"
  FROM (SELECT "companyId", "costCenterId" FROM station_nozzles
        UNION SELECT "companyId", "costCenterId" FROM station_shifts) x
),
cc_agg AS (
  SELECT cc."companyId",
         COUNT(*)                                                         AS station_cost_centers,
         COUNT(*) FILTER (WHERE c."companyId" IS NULL)                    AS cc_tenant_wide,
         COUNT(*) FILTER (WHERE c."companyId" IS NOT NULL AND c."companyId" <> cc."companyId") AS cc_other_company
  FROM cc JOIN cost_centers c ON c.id = cc."costCenterId"
  GROUP BY cc."companyId"
),
nz AS (
  SELECT "companyId", COUNT(*) FILTER (WHERE "isActive") AS nozzles_active, COUNT(*) FILTER (WHERE NOT "isActive") AS nozzles_inactive
  FROM station_nozzles GROUP BY "companyId"
),
sh AS (
  SELECT s."companyId",
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'open')         AS shifts_open,
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'submitted')    AS shifts_submitted,
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'under_review') AS shifts_under_review,
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'approved')     AS shifts_approved,
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'posted')       AS shifts_posted,
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'rejected')     AS shifts_rejected,
         COUNT(*) FILTER (WHERE s."isSeedData")                                   AS seed_shifts,
         MIN(s."shiftDate") FILTER (WHERE NOT s."isSeedData" AND s.status = 'posted') AS posted_from,
         MAX(s."shiftDate") FILTER (WHERE NOT s."isSeedData" AND s.status = 'posted') AS posted_to,
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'posted' AND s."journalEntryId" IS NOT NULL) AS posted_with_entry,
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'posted' AND EXISTS (
           SELECT 1 FROM journal_entries r WHERE r."tenantId" = s."tenantId" AND r."reversalOfEntryId" = s."journalEntryId")) AS posted_entry_reversed,
         COUNT(*) FILTER (WHERE NOT s."isSeedData" AND s.status = 'posted' AND EXISTS (
           SELECT 1 FROM journal_entries j WHERE j.id = s."journalEntryId" AND j.status <> 'posted')) AS posted_entry_not_posted
  FROM station_shifts s GROUP BY s."companyId"
)
SELECT t.id AS tenant_id, t.name AS tenant, c.id AS company_id, c.name AS company, c."businessActivity" AS activity,
       COALESCE(cc_agg.station_cost_centers, 0) AS station_cost_centers,
       COALESCE(cc_agg.cc_tenant_wide, 0)       AS cc_tenant_wide,
       COALESCE(cc_agg.cc_other_company, 0)     AS cc_other_company,
       COALESCE(nz.nozzles_active, 0)           AS nozzles_active,
       COALESCE(nz.nozzles_inactive, 0)         AS nozzles_inactive,
       COALESCE(sh.shifts_open, 0) AS shifts_open, COALESCE(sh.shifts_submitted, 0) AS shifts_submitted,
       COALESCE(sh.shifts_under_review, 0) AS shifts_under_review, COALESCE(sh.shifts_approved, 0) AS shifts_approved,
       COALESCE(sh.shifts_posted, 0) AS shifts_posted, COALESCE(sh.shifts_rejected, 0) AS shifts_rejected,
       COALESCE(sh.seed_shifts, 0) AS seed_shifts,
       sh.posted_from, sh.posted_to,
       COALESCE(sh.posted_with_entry, 0) AS posted_with_entry,
       COALESCE(sh.posted_entry_reversed, 0) AS posted_entry_reversed,
       COALESCE(sh.posted_entry_not_posted, 0) AS posted_entry_not_posted
FROM companies c
JOIN tenants t ON t.id = c."tenantId"
LEFT JOIN cc_agg ON cc_agg."companyId" = c.id
LEFT JOIN nz     ON nz."companyId" = c.id
LEFT JOIN sh     ON sh."companyId" = c.id
ORDER BY t.name, c.name, c.id
