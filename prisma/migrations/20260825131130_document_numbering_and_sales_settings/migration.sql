-- CreateEnum
CREATE TYPE "DocNumberingResetMode" AS ENUM ('continuous', 'annual');

-- DropIndex
DROP INDEX "quotations_tenantId_quoteNumber_key";

-- DropIndex
DROP INDEX "sales_invoices_tenantId_invoiceNumber_key";

-- DropIndex
DROP INDEX "sales_returns_tenantId_returnNumber_key";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "defaultDueDays" INTEGER,
ADD COLUMN     "defaultPaymentTerms" TEXT,
ADD COLUMN     "invoiceShowCustomerReference" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "invoiceShowOtherId" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "invoiceShowPoNumber" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "invoiceShowSalesperson" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "document_numbering_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT 'INV',
    "digits" INTEGER NOT NULL DEFAULT 5,
    "resetMode" "DocNumberingResetMode" NOT NULL DEFAULT 'continuous',
    "nextSeq" INTEGER NOT NULL DEFAULT 1,
    "currentYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_numbering_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_numbering_settings_companyId_docType_key" ON "document_numbering_settings"("companyId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_tenantId_companyId_quoteNumber_key" ON "quotations"("tenantId", "companyId", "quoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_tenantId_companyId_invoiceNumber_key" ON "sales_invoices"("tenantId", "companyId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_tenantId_companyId_returnNumber_key" ON "sales_returns"("tenantId", "companyId", "returnNumber");

-- AddForeignKey
ALTER TABLE "document_numbering_settings" ADD CONSTRAINT "document_numbering_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_numbering_settings" ADD CONSTRAINT "document_numbering_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

