-- مشتريات الوقود وكيف رُحِّلت أسطرها — للقراءة فقط (SELECT وحده).
--
-- "صنف وقود" = اسمه يطابق بنزين/ديزل/سولار/diesel/gasoline/petrol/91/95، أو (في شركة نشاطها fuel_stations)
-- حساب مخزونه 114001 أو 114002. عمود match_reason يبيّن أي الشرطين طابق — راجع القائمة بعينك.
-- أسطر فواتير الشراء بلا صنف لكن حسابها 114001/114002/511001/511004 تُعدّ أيضاً (item_code فارغ).
--
-- صف لكل (شركة، صنف، حساب السطر، حالة الفاتورة):
--   invoices / lines، quantity (الكمية = لترات إن كانت وحدة الصنف لتراً)، line_subtotal (قبل الضريبة)، line_total
--   date_from / date_to — مدى تاريخ الفاتورة
--   line_account_code/name/type — الحساب الذي يحمله السطر ويُرحَّل إليه: 114xxx = مخزون دائم، 5xxxxx = مصروف
--   with_stock_movement — أسطر لها حركة مخزون (sourcePurchaseInvoiceLineId) أي أُدخلت كمية للمستودع
-- الحدود: يُجمَّع بمعرّف الشركة (الاسم فريد داخل المستأجر فقط). شركة بلا أي سطر وقود تظهر بصف واحد فارغ.
-- لا يعدّ مرتجعات الشراء (purchase_returns) — تُضاف إن ظهرت مشتريات وقود فعلاً.
WITH fuel_items AS (
  SELECT i.id, i."companyId", i.code, i.name, i.type::text AS type, i.unit,
         CASE WHEN i.name ~* '(بنزين|ديزل|سولار|diesel|gasoline|petrol)' OR i.name ~ '(^|[^0-9])9[15]([^0-9]|$)' THEN 'name'
              ELSE 'stock_account_114' END AS match_reason
  FROM items i
  JOIN companies co ON co.id = i."companyId"
  LEFT JOIN accounts sa ON sa.id = i."stockAccountId"
  WHERE i.name ~* '(بنزين|ديزل|سولار|diesel|gasoline|petrol)' OR i.name ~ '(^|[^0-9])9[15]([^0-9]|$)'
     OR (co."businessActivity" = 'fuel_stations' AND sa.code IN ('114001', '114002'))
),
fuel_lines AS (
  SELECT pi."companyId", pi.id AS invoice_id, pi.status::text AS invoice_status, pi.date, pl.id AS line_id,
         pl."itemId", pl."accountId", pl.quantity, pl.subtotal, pl.total
  FROM purchase_invoice_lines pl
  JOIN purchase_invoices pi ON pi.id = pl."invoiceId"
  JOIN accounts a ON a.id = pl."accountId"
  WHERE pl."itemId" IN (SELECT id FROM fuel_items)
     OR (pl."itemId" IS NULL AND a.code IN ('114001', '114002', '511001', '511004'))
),
agg AS (
  SELECT fl."companyId", fl."itemId", fl."accountId", fl.invoice_status,
         COUNT(DISTINCT fl.invoice_id) AS invoices, COUNT(*) AS lines,
         SUM(fl.quantity) AS quantity, SUM(fl.subtotal) AS line_subtotal, SUM(fl.total) AS line_total,
         MIN(fl.date) AS date_from, MAX(fl.date) AS date_to,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM stock_movements m WHERE m."sourcePurchaseInvoiceLineId" = fl.line_id)) AS with_stock_movement
  FROM fuel_lines fl
  GROUP BY fl."companyId", fl."itemId", fl."accountId", fl.invoice_status
)
SELECT t.id AS tenant_id, t.name AS tenant, c.id AS company_id, c.name AS company,
       fi.code AS item_code, fi.name AS item_name, fi.type AS item_type, fi.unit AS item_unit, fi.match_reason,
       a.code AS line_account_code, a.name AS line_account_name, a.type::text AS line_account_type,
       agg.invoice_status, COALESCE(agg.invoices, 0) AS invoices, COALESCE(agg.lines, 0) AS lines,
       agg.quantity, agg.line_subtotal, agg.line_total, agg.date_from, agg.date_to,
       COALESCE(agg.with_stock_movement, 0) AS with_stock_movement
FROM companies c
JOIN tenants t ON t.id = c."tenantId"
LEFT JOIN agg ON agg."companyId" = c.id
LEFT JOIN fuel_items fi ON fi.id = agg."itemId"
LEFT JOIN accounts a ON a.id = agg."accountId"
ORDER BY t.name, c.name, c.id, fi.code NULLS LAST, a.code, agg.invoice_status
