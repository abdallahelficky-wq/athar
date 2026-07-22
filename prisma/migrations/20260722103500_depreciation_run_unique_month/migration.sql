-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_tenantId_companyId_month_key" ON "depreciation_runs"("tenantId", "companyId", "month");
