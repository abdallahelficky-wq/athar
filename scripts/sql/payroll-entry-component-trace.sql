-- تتبّع قيد رواتب مرحَّل إلى بنوده: لكل سطر في القيد، أي بند راتب (من لقطة الترحيل postedSnapshot) أنتجه ولأي موظف،
-- وعلى أي حساب — للقراءة فقط. يجيب: «أي بند يُرحَّل على رواتب مستحقة في القيد J02074 ولماذا».
--
-- التشغيل (psql)، بالمعرّف لا بالاسم — اسم الشركة فريد داخل المستأجر فقط، ورقم القيد فريد داخل الشركة فقط:
--   psql "$DB" -v company_id="'<companies.id>'" -v entry_number="'J02074'" -f scripts/sql/payroll-entry-component-trace.sql
--
-- ما يعدّه:
--   الجزء 1 — لكل (موظف، بند) قيمة غير صفرية في لقطة الكشف: اسم البند ونوعه ومفتاحه النظامي، والحساب الذي رُحِّل
--             عليه وقت الترحيل (accountId في اللقطة)، والحساب المربوط بالبند اليوم (لو تغيّر بعد الترحيل)،
--             وهل يوجد في القيد سطر مطابق (نفس الموظف، نفس الحساب، نفس المبلغ).
--   الجزء 2 — ملخص بالحساب: مجموع أسطر القيد لكل حساب، مقابل مجموع قيم البنود المربوطة به في اللقطة، وأسماء تلك البنود.
--             سطر الصافي (حساب الموظف الفرعي أو «رواتب مستحقة للصرف») يظهر بعمود net_from_snapshot.
-- حدوده:
--   - يعتمد على postedSnapshot المحفوظ لحظة الترحيل؛ الكشوف المرحَّلة قبل وجود اللقطة لا تُتتبَّع (يُرجِع صفر صفوف للجزء 1).
--   - قسط السلفة يُرحَّل بالأقل بين القيمة والرصيد المتبقي وقتها، فقد يختلف مبلغ سطره عن قيمة اللقطة (matched_line=false).
--   - ترحيل الإجماليات (payrollTotalsFromMonth) يجمع الموظفين في سطر واحد لكل بند: الجزء 1 يُظهر matched_line=false
--     لكل البنود غير السلف، والجزء 2 هو المرجع في هذه الحالة.

-- الجزء 1: لكل موظف ولكل بند
WITH je AS (
  SELECT j.id, j."tenantId", j."companyId", j."sourceId"
  FROM journal_entries j
  WHERE j."companyId" = :company_id AND j."entryNumber" = :entry_number AND j."sourceModule" = 'payroll'
),
run AS (
  SELECT r.id, r."postedSnapshot" AS snap, je.id AS entry_id, je."tenantId", je."companyId"
  FROM payroll_runs r JOIN je ON r.id = je."sourceId" AND r."tenantId" = je."tenantId" AND r."companyId" = je."companyId"
),
comp AS (
  SELECT run.entry_id, run."tenantId", run."companyId", c->>'id' AS component_id, c->>'name' AS component_name,
         c->>'kind' AS kind, c->>'systemKey' AS system_key, c->>'accountId' AS snapshot_account_id
  FROM run, jsonb_array_elements(run.snap->'components') c
),
val AS (
  SELECT run.entry_id, row->>'employeeId' AS employee_id, row->>'employeeName' AS employee_name, (row->>'net')::numeric AS net,
         kv.key AS component_id, kv.value::numeric AS value
  FROM run, jsonb_array_elements(run.snap->'rows') row, jsonb_each_text(row->'componentValues') kv
  WHERE kv.value::numeric <> 0
)
SELECT v.employee_name, v.employee_id, v.net AS employee_net,
       c.component_name, c.kind, c.system_key, v.value,
       a.code AS posted_account_code, a.name AS posted_account_name, a.type AS posted_account_type,
       ca.code AS current_component_account_code, ca.name AS current_component_account_name,
       EXISTS (SELECT 1 FROM journal_entry_lines l
               WHERE l."journalEntryId" = v.entry_id AND l."employeeId" = v.employee_id AND l."accountId" = c.snapshot_account_id
                 AND (l.debit + l.credit) = round(v.value, 2)) AS matched_line
FROM val v
JOIN comp c ON c.entry_id = v.entry_id AND c.component_id = v.component_id
LEFT JOIN accounts a ON a.id = c.snapshot_account_id AND a."companyId" = c."companyId"
LEFT JOIN payroll_components pc ON pc.id = c.component_id AND pc."companyId" = c."companyId"
LEFT JOIN accounts ca ON ca.id = pc."accountId" AND ca."companyId" = c."companyId"
ORDER BY v.employee_name, c.kind, c.component_name;

-- الجزء 2: ملخص بالحساب — أسطر القيد مقابل البنود المربوطة بالحساب في اللقطة
WITH je AS (
  SELECT j.id, j."tenantId", j."companyId", j."sourceId"
  FROM journal_entries j
  WHERE j."companyId" = :company_id AND j."entryNumber" = :entry_number AND j."sourceModule" = 'payroll'
),
run AS (
  SELECT r."postedSnapshot" AS snap, je.id AS entry_id, je."companyId"
  FROM payroll_runs r JOIN je ON r.id = je."sourceId" AND r."tenantId" = je."tenantId" AND r."companyId" = je."companyId"
),
comp AS (
  SELECT c->>'id' AS component_id, c->>'name' AS component_name, c->>'accountId' AS account_id
  FROM run, jsonb_array_elements(run.snap->'components') c
),
val AS (
  SELECT kv.key AS component_id, kv.value::numeric AS value
  FROM run, jsonb_array_elements(run.snap->'rows') row, jsonb_each_text(row->'componentValues') kv
  WHERE kv.value::numeric <> 0
),
by_account_snapshot AS (
  SELECT c.account_id, SUM(v.value) AS snapshot_total, string_agg(DISTINCT c.component_name, ' | ') AS components
  FROM val v JOIN comp c ON c.component_id = v.component_id
  GROUP BY c.account_id
),
by_account_lines AS (
  SELECT l."accountId" AS account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit, COUNT(*) AS lines,
         COUNT(DISTINCT l."employeeId") AS employees
  FROM journal_entry_lines l JOIN je ON l."journalEntryId" = je.id
  GROUP BY l."accountId"
)
SELECT a.code, a.name, a.type, p.name AS parent_name, bl.lines, bl.employees, bl.debit, bl.credit,
       bs.snapshot_total AS components_total_in_snapshot, bs.components AS components_mapped_here,
       CASE WHEN bs.account_id IS NULL THEN round(bl.credit - bl.debit, 2) END AS net_from_snapshot
FROM by_account_lines bl
JOIN je ON true
JOIN accounts a ON a.id = bl.account_id AND a."companyId" = je."companyId"
LEFT JOIN accounts p ON p.id = a."parentId" AND p."companyId" = je."companyId"
LEFT JOIN by_account_snapshot bs ON bs.account_id = bl.account_id
ORDER BY a.code;
