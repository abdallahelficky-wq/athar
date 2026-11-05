-- إعداد السنة المالية وإقفالها: شهر بداية السنة وحساب الإقفال على الشركة، مصدر قيد جديد، وجدول سجلات الإقفال. كلها إضافية.
-- AlterEnum
ALTER TYPE "SourceModule" ADD VALUE 'fiscal_year_closing';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "fiscalCloseAccountId" TEXT;

-- CreateTable
CREATE TABLE "fiscal_year_closings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "yearStart" TIMESTAMP(3) NOT NULL,
    "yearEnd" TIMESTAMP(3) NOT NULL,
    "journalEntryId" TEXT,
    "closeAccountId" TEXT NOT NULL,
    "totalRevenue" DECIMAL(18,2) NOT NULL,
    "totalExpense" DECIMAL(18,2) NOT NULL,
    "netIncome" DECIMAL(18,2) NOT NULL,
    "previousClosingDate" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_year_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_year_closings_journalEntryId_key" ON "fiscal_year_closings"("journalEntryId");
CREATE UNIQUE INDEX "fiscal_year_closings_companyId_yearEnd_key" ON "fiscal_year_closings"("companyId", "yearEnd");
CREATE INDEX "fiscal_year_closings_tenantId_companyId_idx" ON "fiscal_year_closings"("tenantId", "companyId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_fiscalCloseAccountId_fkey" FOREIGN KEY ("fiscalCloseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiscal_year_closings" ADD CONSTRAINT "fiscal_year_closings_closeAccountId_fkey" FOREIGN KEY ("closeAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
