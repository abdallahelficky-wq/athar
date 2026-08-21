-- Move Branch classification from JournalEntry (whole-entry level) to JournalEntryLine
-- (line level), matching the existing costCenterId/departmentId pattern so a single entry
-- can have lines split across different branches.

-- AlterTable: add the new column first so existing branchId values can be copied down
-- before the old column is dropped.
ALTER TABLE "journal_entry_lines" ADD COLUMN "branchId" TEXT;

-- Data migration: copy each journal entry's branchId to all of its existing lines, so no
-- data already tagged with a branch is lost by this move.
UPDATE "journal_entry_lines" AS jel
SET "branchId" = je."branchId"
FROM "journal_entries" AS je
WHERE jel."journalEntryId" = je."id" AND je."branchId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_branchId_fkey";

-- DropIndex
DROP INDEX "journal_entries_tenantId_branchId_idx";

-- AlterTable
ALTER TABLE "journal_entries" DROP COLUMN "branchId";

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
