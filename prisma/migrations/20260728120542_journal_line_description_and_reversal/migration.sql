-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "reversalOfEntryId" TEXT;

-- AlterTable
ALTER TABLE "journal_entry_lines" ADD COLUMN     "description" TEXT;

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_reversalOfEntryId_idx" ON "journal_entries"("tenantId", "reversalOfEntryId");
