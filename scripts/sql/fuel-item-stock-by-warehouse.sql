-- رصيد أصناف الوقود لكل مستودع ومتوسط تكلفتها — للقراءة فقط (SELECT وحده).
--
-- "صنف وقود" بنفس تعريف fuel-purchases-posting.sql (match_reason يبيّن الشرط).
-- quantity_on_hand بنفس منطق costingEngine.getItemTotalOnHand وinventoryReports: in/transfer_in موجب،
-- out/issue/transfer_out سالب، adjustment بإشارته المخزَّنة.
-- average_cost = Item.averageCost — **على مستوى الصنف كله لا المستودع** (costingEngine.ts)، فيتكرّر نفسه لكل مستودع.
-- value_at_average = quantity_on_hand × average_cost (تقدير؛ قارنه برصيد 114001/114002 في fuel-account-balances.sql).
-- moves_in / moves_out / moves_adjustment، first_move / last_move.
-- الحدود: صنف وقود بلا أي حركة يظهر بلا مستودع. شركة بلا أصناف وقود تظهر بصف واحد فارغ. يُجمَّع بالمعرّفات.
WITH fuel_items AS (
  SELECT i.id, i."companyId", i.code, i.name, i.type::text AS type, i.unit, i."averageCost", i."lastPurchasePrice",
         CASE WHEN i.name ~* '(بنزين|ديزل|سولار|diesel|gasoline|petrol)' OR i.name ~ '(^|[^0-9])9[15]([^0-9]|$)' THEN 'name'
              ELSE 'stock_account_114' END AS match_reason
  FROM items i
  JOIN companies co ON co.id = i."companyId"
  LEFT JOIN accounts sa ON sa.id = i."stockAccountId"
  WHERE i.name ~* '(بنزين|ديزل|سولار|diesel|gasoline|petrol)' OR i.name ~ '(^|[^0-9])9[15]([^0-9]|$)'
     OR (co."businessActivity" = 'fuel_stations' AND sa.code IN ('114001', '114002'))
),
mv AS (
  SELECT m."itemId", m."warehouseId",
         SUM(CASE WHEN m.type IN ('in', 'transfer_in') THEN m.quantity
                  WHEN m.type IN ('out', 'issue', 'transfer_out') THEN -m.quantity
                  WHEN m.type = 'adjustment' THEN m.quantity ELSE 0 END) AS quantity_on_hand,
         COUNT(*) FILTER (WHERE m.type IN ('in', 'transfer_in'))               AS moves_in,
         COUNT(*) FILTER (WHERE m.type IN ('out', 'issue', 'transfer_out'))    AS moves_out,
         COUNT(*) FILTER (WHERE m.type = 'adjustment')                         AS moves_adjustment,
         MIN(m.date) AS first_move, MAX(m.date) AS last_move
  FROM stock_movements m
  WHERE m."itemId" IN (SELECT id FROM fuel_items)
  GROUP BY m."itemId", m."warehouseId"
)
SELECT t.id AS tenant_id, t.name AS tenant, c.id AS company_id, c.name AS company,
       fi.code AS item_code, fi.name AS item_name, fi.type AS item_type, fi.unit AS item_unit, fi.match_reason,
       w.id AS warehouse_id, w.name AS warehouse_name, w."isDefault" AS warehouse_is_default,
       mv.quantity_on_hand, fi."averageCost" AS average_cost, fi."lastPurchasePrice" AS last_purchase_price,
       ROUND(mv.quantity_on_hand * fi."averageCost", 2) AS value_at_average,
       COALESCE(mv.moves_in, 0) AS moves_in, COALESCE(mv.moves_out, 0) AS moves_out,
       COALESCE(mv.moves_adjustment, 0) AS moves_adjustment, mv.first_move, mv.last_move
FROM companies c
JOIN tenants t ON t.id = c."tenantId"
LEFT JOIN fuel_items fi ON fi."companyId" = c.id
LEFT JOIN mv ON mv."itemId" = fi.id
LEFT JOIN warehouses w ON w.id = mv."warehouseId"
ORDER BY t.name, c.name, c.id, fi.code, w.name
