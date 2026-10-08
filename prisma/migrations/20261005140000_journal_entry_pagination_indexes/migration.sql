-- CreateIndex
CREATE INDEX "journal_entries_tenantId_companyId_date_entrySeq_id_idx" ON "journal_entries"("tenantId", "companyId", "date", "entrySeq", "id");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_companyId_totalDebit_id_idx" ON "journal_entries"("tenantId", "companyId", "totalDebit", "id");
