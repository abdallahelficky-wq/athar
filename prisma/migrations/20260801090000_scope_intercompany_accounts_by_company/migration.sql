DROP INDEX IF EXISTS "accounts_tenantId_intercompanyCompanyId_key";

CREATE UNIQUE INDEX "accounts_tenantId_companyId_intercompanyCompanyId_key"
ON "accounts"("tenantId", "companyId", "intercompanyCompanyId");
