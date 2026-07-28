-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('saved', 'posted');

-- AlterTable: numbering fields on companies
ALTER TABLE "companies" ADD COLUMN     "nextJournalEntrySeq" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "numberingPrefix" TEXT;

-- AlterTable: entryNumber column (new, all-null for existing rows on purpose)
ALTER TABLE "journal_entries" ADD COLUMN     "entryNumber" TEXT;

-- Switch journal_entries.status from the old shared JournalStatus enum to the new
-- JournalEntryStatus enum, mapping existing 'draft' rows to 'saved' explicitly via USING
-- (a plain DROP+ADD COLUMN as Prisma would normally generate here would silently reset every
-- existing row to the new column's default value instead of preserving draft-vs-posted history).
ALTER TABLE "journal_entries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "journal_entries" ALTER COLUMN "status" TYPE "JournalEntryStatus" USING (
  CASE WHEN "status"::text = 'draft' THEN 'saved' ELSE 'posted' END
)::"JournalEntryStatus";
ALTER TABLE "journal_entries" ALTER COLUMN "status" SET DEFAULT 'posted';

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenantId_numberingPrefix_key" ON "companies"("tenantId", "numberingPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenantId_entryNumber_key" ON "journal_entries"("tenantId", "entryNumber");
