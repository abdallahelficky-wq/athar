/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,intercompanyCompanyId]` on the table `accounts` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "intercompanyCompanyId" TEXT;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "mirrorEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenantId_intercompanyCompanyId_key" ON "accounts"("tenantId", "intercompanyCompanyId");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_mirrorEntryId_idx" ON "journal_entries"("tenantId", "mirrorEntryId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_intercompanyCompanyId_fkey" FOREIGN KEY ("intercompanyCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
