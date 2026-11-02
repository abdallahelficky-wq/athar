-- قيود على حسابات الوقود 114001 / 114002 / 511001 / 511004 من غير فواتير الشراء — للقراءة فقط (SELECT وحده).
--
-- صف لكل (شركة، حساب، مصدر القيد sourceModule، حالة القيد) — يُستبعَد sourceModule = purchase_invoice
-- (تغطّيه fuel-purchases-posting.sql). manual = قيد يدوي؛ يظهر أيضاً stock_movement وbulk_import
-- وperiodic_inventory_settlement وstation_shift وقيود العكس (sourceModule = manual مع reversal_entries > 0).
--   entries، debit، credit، date_from، date_to، reversal_entries (منها قيود عكس)، mirror_entries (لها قيد مرآة)
-- الحدود: الحساب يُطابَق برمزه داخل شركته — شجرة غير قالب المحطات قد تستخدم الرمز نفسه لحساب آخر (account_name
-- يبيّن ذلك). شركة بلا أي من هذه الحسابات تظهر بصف واحد فارغ. يُجمَّع بالمعرّفات لا بالأسماء.
WITH accts AS (
  SELECT a.id, a."companyId", a.code, a.name FROM accounts a WHERE a.code IN ('114001', '114002', '511001', '511004')
),
agg AS (
  SELECT e."companyId", l."accountId", e."sourceModule"::text AS source_module, e.status::text AS entry_status,
         COUNT(DISTINCT e.id) AS entries, SUM(l.debit) AS debit, SUM(l.credit) AS credit,
         MIN(e.date) AS date_from, MAX(e.date) AS date_to,
         COUNT(DISTINCT e.id) FILTER (WHERE e."reversalOfEntryId" IS NOT NULL) AS reversal_entries,
         COUNT(DISTINCT e.id) FILTER (WHERE e."mirrorEntryId" IS NOT NULL) AS mirror_entries
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l."journalEntryId"
  WHERE l."accountId" IN (SELECT id FROM accts) AND e."sourceModule" <> 'purchase_invoice'
  GROUP BY e."companyId", l."accountId", e."sourceModule", e.status
)
SELECT t.id AS tenant_id, t.name AS tenant, c.id AS company_id, c.name AS company,
       a.code AS account_code, a.name AS account_name, agg.source_module, agg.entry_status,
       COALESCE(agg.entries, 0) AS entries, agg.debit, agg.credit, agg.date_from, agg.date_to,
       COALESCE(agg.reversal_entries, 0) AS reversal_entries, COALESCE(agg.mirror_entries, 0) AS mirror_entries
FROM companies c
JOIN tenants t ON t.id = c."tenantId"
LEFT JOIN agg ON agg."companyId" = c.id
LEFT JOIN accts a ON a.id = agg."accountId"
ORDER BY t.name, c.name, c.id, a.code, agg.source_module, agg.entry_status
