-- Stop displaying random CUID fragments for legacy journal entries. Every company now starts
-- with the default prefix J, while the prefix remains editable from the company-data screen.
DROP INDEX IF EXISTS "companies_tenantId_numberingPrefix_key";
DROP INDEX IF EXISTS "journal_entries_tenantId_entryNumber_key";

ALTER TABLE "companies" ALTER COLUMN "numberingPrefix" SET DEFAULT 'J';
UPDATE "companies" SET "numberingPrefix" = 'J' WHERE "numberingPrefix" IS NULL OR "numberingPrefix" = '';
ALTER TABLE "companies" ALTER COLUMN "numberingPrefix" SET NOT NULL;

-- Backfill old rows in deterministic creation order, independently for every company. Existing
-- sequential numbers are retained; this targets only the rows that were previously shown as CUIDs.
WITH numbered AS (
  SELECT
    je."id",
    c."numberingPrefix" AS prefix,
    COALESCE(existing.max_seq, 0)
      + ROW_NUMBER() OVER (PARTITION BY je."companyId" ORDER BY je."createdAt", je."id") AS seq
  FROM "journal_entries" je
  JOIN "companies" c ON c."id" = je."companyId"
  LEFT JOIN LATERAL (
    SELECT MAX(SUBSTRING(existing_je."entryNumber" FROM '([0-9]+)$')::integer) AS max_seq
    FROM "journal_entries" existing_je
    WHERE existing_je."companyId" = je."companyId"
      AND existing_je."entryNumber" IS NOT NULL
      AND existing_je."entryNumber" LIKE c."numberingPrefix" || '%'
  ) existing ON TRUE
  WHERE je."entryNumber" IS NULL
)
UPDATE "journal_entries" je
SET "entryNumber" = numbered.prefix || LPAD(numbered.seq::text, 5, '0')
FROM numbered
WHERE je."id" = numbered."id" AND je."entryNumber" IS NULL;

ALTER TABLE "journal_entries" ALTER COLUMN "entryNumber" SET NOT NULL;

-- Continue each company's counter after its highest assigned sequence.
UPDATE "companies" c
SET "nextJournalEntrySeq" = COALESCE((
  SELECT MAX(SUBSTRING(je."entryNumber" FROM '([0-9]+)$')::integer) + 1
  FROM "journal_entries" je
  WHERE je."companyId" = c."id"
    AND je."entryNumber" LIKE c."numberingPrefix" || '%'
), 1);

CREATE UNIQUE INDEX "journal_entries_companyId_entryNumber_key"
ON "journal_entries"("companyId", "entryNumber");
