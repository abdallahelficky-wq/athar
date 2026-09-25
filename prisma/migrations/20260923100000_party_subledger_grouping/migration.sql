-- Separates the auto-generated customer/supplier sub-ledger accounts from the standard,
-- manually-seeded receivable/payable accounts that used to share the same parent group
-- ("112" الذمم المدينة التجارية / "211" الذمم الدائنة التجارية).
--
-- Design: keep "112"/"211" as the (renamed) sub-ledger parent that partyAccounts.ts still
-- targets unchanged, and move only the standard accounts out to two new sibling level-3
-- groups ("117"/"217"), leaving codes, levels and isPosting untouched on every moved
-- account. No account is renumbered, no journal_entry_lines row is touched, and no
-- Company.zatcaNextIcv/zatcaLastInvoiceHash-style counter exists on this path to disturb.
--
-- "Standard" vs. "sub-ledger" is decided per company by whether Customer.accountId /
-- Supplier.accountId references the child account — NOT by a fixed code list, because the
-- exact set of standard accounts seeded under 112/211 differs across the chart templates
-- (5 to 7 for customers, 4 to 5 for suppliers, depending on business activity).
--
-- Every step below is scoped to companies whose chart already matches the exact expected
-- shape (right code, level, type, isPosting, and — for 117/217 — right parent), so a
-- tenant/company with a customized or unexpected chart is left untouched rather than
-- guessed at. Every step is also independently idempotent: re-running this migration
-- against an already-migrated (or freshly-seeded, already-correct) database updates zero
-- rows.

-- ============================== Receivables: 112 -> 117 ==============================

-- Step 1: create the new "الذمم المدينة القياسية" / "Standard Trade Receivables" group
-- (117) as a sibling of 112 under the same "11" parent, for every company that has a
-- properly-shaped 112 and does not already have a matching 117.
WITH r112 AS (
  SELECT a."id" AS a112_id, a."tenantId", a."companyId", p11."id" AS a11_id
  FROM "accounts" a
  JOIN "accounts" p11 ON p11."id" = a."parentId"
  WHERE a."code" = '112' AND a."level" = 3 AND a."type" = 'asset' AND a."isPosting" = false
    AND p11."code" = '11' AND p11."level" = 2 AND p11."type" = 'asset' AND p11."isPosting" = false
),
existing117 AS (
  SELECT "id", "tenantId", "companyId", "parentId", "level", "type", "isPosting"
  FROM "accounts" WHERE "code" = '117'
)
INSERT INTO "accounts" (
  "id", "tenantId", "companyId", "parentId", "code", "level", "isPosting", "isArchived",
  "name", "nameEn", "type", "isActive", "isBankOrCash", "createdAt", "updatedAt"
)
SELECT
  md5('party-subledger-grouping-117-' || r."tenantId" || '-' || COALESCE(r."companyId", 'group')),
  r."tenantId", r."companyId", r.a11_id, '117', 3, false, false,
  'الذمم المدينة القياسية', 'Standard Trade Receivables', 'asset', true, false, NOW(), NOW()
FROM r112 r
LEFT JOIN existing117 e
  ON e."tenantId" = r."tenantId" AND e."companyId" IS NOT DISTINCT FROM r."companyId"
WHERE e."id" IS NULL;

-- Step 2: move every direct child of 112 that is NOT a customer's own sub-ledger account
-- (i.e. no Customer.accountId points at it) onto the new 117 group. Scoped to companies
-- where 117 now exists with exactly the expected shape (just-inserted above, or already
-- present and valid from an earlier run) — a company whose "117" code is taken by something
-- else entirely is excluded here and left untouched.
WITH r112 AS (
  SELECT a."id" AS a112_id, a."tenantId", a."companyId", p11."id" AS a11_id
  FROM "accounts" a
  JOIN "accounts" p11 ON p11."id" = a."parentId"
  WHERE a."code" = '112' AND a."level" = 3 AND a."type" = 'asset' AND a."isPosting" = false
    AND p11."code" = '11' AND p11."level" = 2 AND p11."type" = 'asset' AND p11."isPosting" = false
),
target117 AS (
  SELECT r.a112_id, r."tenantId", r."companyId", e."id" AS a117_id
  FROM r112 r
  JOIN "accounts" e
    ON e."tenantId" = r."tenantId" AND e."companyId" IS NOT DISTINCT FROM r."companyId"
   AND e."code" = '117' AND e."level" = 3 AND e."type" = 'asset' AND e."isPosting" = false
   AND e."parentId" = r.a11_id
)
UPDATE "accounts" child
SET "parentId" = t.a117_id
FROM target117 t
WHERE child."parentId" = t.a112_id
  AND child."level" = 4
  AND child."isPosting" = true
  AND NOT EXISTS (
    SELECT 1 FROM "customers" c
    WHERE c."tenantId" = t."tenantId" AND c."companyId" IS NOT DISTINCT FROM t."companyId"
      AND c."accountId" = child."id"
  );

-- Step 3: rename 112 to reflect that it now holds only the auto-generated customer
-- sub-ledger accounts. Gated on the same "117 exists and matches" condition as step 2, so
-- it only fires for companies actually processed above.
WITH r112 AS (
  SELECT a."id" AS a112_id, a."tenantId", a."companyId", p11."id" AS a11_id
  FROM "accounts" a
  JOIN "accounts" p11 ON p11."id" = a."parentId"
  WHERE a."code" = '112' AND a."level" = 3 AND a."type" = 'asset' AND a."isPosting" = false
    AND p11."code" = '11' AND p11."level" = 2 AND p11."type" = 'asset' AND p11."isPosting" = false
),
target117 AS (
  SELECT r.a112_id, r."tenantId", r."companyId"
  FROM r112 r
  JOIN "accounts" e
    ON e."tenantId" = r."tenantId" AND e."companyId" IS NOT DISTINCT FROM r."companyId"
   AND e."code" = '117' AND e."level" = 3 AND e."type" = 'asset' AND e."isPosting" = false
   AND e."parentId" = r.a11_id
)
UPDATE "accounts" a
SET "name" = 'عملاء', "nameEn" = 'Customers'
FROM target117 t
WHERE a."id" = t.a112_id;

-- ============================== Payables: 211 -> 217 ==============================

-- Mirror of the three receivables steps above: "217" الذمم الدائنة القياسية / "Standard
-- Trade Payables" as a new sibling of 211 under the same "21" parent, standard (non-
-- supplier-linked) children of 211 moved onto it, then 211 renamed to "موردون" / "Suppliers".

WITH r211 AS (
  SELECT a."id" AS a211_id, a."tenantId", a."companyId", p21."id" AS a21_id
  FROM "accounts" a
  JOIN "accounts" p21 ON p21."id" = a."parentId"
  WHERE a."code" = '211' AND a."level" = 3 AND a."type" = 'liability' AND a."isPosting" = false
    AND p21."code" = '21' AND p21."level" = 2 AND p21."type" = 'liability' AND p21."isPosting" = false
),
existing217 AS (
  SELECT "id", "tenantId", "companyId", "parentId", "level", "type", "isPosting"
  FROM "accounts" WHERE "code" = '217'
)
INSERT INTO "accounts" (
  "id", "tenantId", "companyId", "parentId", "code", "level", "isPosting", "isArchived",
  "name", "nameEn", "type", "isActive", "isBankOrCash", "createdAt", "updatedAt"
)
SELECT
  md5('party-subledger-grouping-217-' || r."tenantId" || '-' || COALESCE(r."companyId", 'group')),
  r."tenantId", r."companyId", r.a21_id, '217', 3, false, false,
  'الذمم الدائنة القياسية', 'Standard Trade Payables', 'liability', true, false, NOW(), NOW()
FROM r211 r
LEFT JOIN existing217 e
  ON e."tenantId" = r."tenantId" AND e."companyId" IS NOT DISTINCT FROM r."companyId"
WHERE e."id" IS NULL;

WITH r211 AS (
  SELECT a."id" AS a211_id, a."tenantId", a."companyId", p21."id" AS a21_id
  FROM "accounts" a
  JOIN "accounts" p21 ON p21."id" = a."parentId"
  WHERE a."code" = '211' AND a."level" = 3 AND a."type" = 'liability' AND a."isPosting" = false
    AND p21."code" = '21' AND p21."level" = 2 AND p21."type" = 'liability' AND p21."isPosting" = false
),
target217 AS (
  SELECT r.a211_id, r."tenantId", r."companyId", e."id" AS a217_id
  FROM r211 r
  JOIN "accounts" e
    ON e."tenantId" = r."tenantId" AND e."companyId" IS NOT DISTINCT FROM r."companyId"
   AND e."code" = '217' AND e."level" = 3 AND e."type" = 'liability' AND e."isPosting" = false
   AND e."parentId" = r.a21_id
)
UPDATE "accounts" child
SET "parentId" = t.a217_id
FROM target217 t
WHERE child."parentId" = t.a211_id
  AND child."level" = 4
  AND child."isPosting" = true
  AND NOT EXISTS (
    SELECT 1 FROM "suppliers" s
    WHERE s."tenantId" = t."tenantId" AND s."companyId" IS NOT DISTINCT FROM t."companyId"
      AND s."accountId" = child."id"
  );

WITH r211 AS (
  SELECT a."id" AS a211_id, a."tenantId", a."companyId", p21."id" AS a21_id
  FROM "accounts" a
  JOIN "accounts" p21 ON p21."id" = a."parentId"
  WHERE a."code" = '211' AND a."level" = 3 AND a."type" = 'liability' AND a."isPosting" = false
    AND p21."code" = '21' AND p21."level" = 2 AND p21."type" = 'liability' AND p21."isPosting" = false
),
target217 AS (
  SELECT r.a211_id, r."tenantId", r."companyId"
  FROM r211 r
  JOIN "accounts" e
    ON e."tenantId" = r."tenantId" AND e."companyId" IS NOT DISTINCT FROM r."companyId"
   AND e."code" = '217' AND e."level" = 3 AND e."type" = 'liability' AND e."isPosting" = false
   AND e."parentId" = r.a21_id
)
UPDATE "accounts" a
SET "name" = 'موردون', "nameEn" = 'Suppliers'
FROM target217 t
WHERE a."id" = t.a211_id;
