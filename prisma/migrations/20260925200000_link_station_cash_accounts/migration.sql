-- Data-only backfill, no schema change.
--
-- Fuel-station companies created through tenant registration (auth.service register) were never
-- linked to their station cash shortage/surplus accounts — only companies created from Settings
-- were — so posting any station shift failed with "لم يُحدَّد حسابا عجز/زيادة نقدية ورديات المحطات".
-- Registration now links them (linkStationCashAccounts in src/lib/starterData.ts); this fills the
-- same two fields for existing fuel-station companies from the accounts their chart template
-- already created (codes 622005 / 431003).
--
-- Only NULL fields are filled: an account an administrator chose explicitly is never overridden,
-- and a company whose chart has no such account is left untouched.
UPDATE "companies" AS c
SET "stationCashShortageAccountId" = a."id"
FROM "accounts" AS a
WHERE c."businessActivity" = 'fuel_stations'
  AND c."stationCashShortageAccountId" IS NULL
  AND a."companyId" = c."id"
  AND a."code" = '622005';

UPDATE "companies" AS c
SET "stationCashSurplusAccountId" = a."id"
FROM "accounts" AS a
WHERE c."businessActivity" = 'fuel_stations'
  AND c."stationCashSurplusAccountId" IS NULL
  AND a."companyId" = c."id"
  AND a."code" = '431003';
