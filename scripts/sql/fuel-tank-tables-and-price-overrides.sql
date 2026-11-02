-- جداول الخزانات غير المستخدَمة وأسعار الوقود الخاصة بمحطة — للقراءة فقط (SELECT وحده)، صف لكل شركة.
--
--   tank_deliveries_rows / tank_dips_rows — صفوف جدولَي tank_deliveries وtank_dips (لا كود يكتب فيهما؛ المتوقَّع صفر)
--   fuel_prices_rows                      — كل أسعار الوقود
--   fuel_price_station_overrides          — منها بـcostCenterId غير فارغ (سعر خاص بمحطة يتغلّب على السعر العام)
--   override_stations                     — عدد المحطات المميّزة التي لها سعر خاص
--   override_from / override_to           — مدى effectiveFrom للأسعار الخاصة
-- الحدود: يعدّ ولا يقرأ مبالغ. يُجمَّع بمعرّف الشركة.
SELECT t.id AS tenant_id, t.name AS tenant, c.id AS company_id, c.name AS company,
       (SELECT COUNT(*) FROM tank_deliveries d WHERE d."companyId" = c.id) AS tank_deliveries_rows,
       (SELECT COUNT(*) FROM tank_dips d WHERE d."companyId" = c.id)       AS tank_dips_rows,
       (SELECT COUNT(*) FROM fuel_prices p WHERE p."companyId" = c.id)     AS fuel_prices_rows,
       (SELECT COUNT(*) FROM fuel_prices p WHERE p."companyId" = c.id AND p."costCenterId" IS NOT NULL) AS fuel_price_station_overrides,
       (SELECT COUNT(DISTINCT p."costCenterId") FROM fuel_prices p WHERE p."companyId" = c.id AND p."costCenterId" IS NOT NULL) AS override_stations,
       (SELECT MIN(p."effectiveFrom") FROM fuel_prices p WHERE p."companyId" = c.id AND p."costCenterId" IS NOT NULL) AS override_from,
       (SELECT MAX(p."effectiveFrom") FROM fuel_prices p WHERE p."companyId" = c.id AND p."costCenterId" IS NOT NULL) AS override_to
FROM companies c
JOIN tenants t ON t.id = c."tenantId"
ORDER BY t.name, c.name, c.id
