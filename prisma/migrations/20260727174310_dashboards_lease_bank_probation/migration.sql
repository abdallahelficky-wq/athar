-- CreateEnum
CREATE TYPE "VatFilingFrequency" AS ENUM ('monthly', 'quarterly');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "isBankOrCash" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "lowCashThreshold" DECIMAL(18,2),
ADD COLUMN     "overdueInvoiceDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "staleDraftDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "vatFilingFrequency" "VatFilingFrequency" NOT NULL DEFAULT 'quarterly',
ADD COLUMN     "zakatDeclarationDueDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "probationEndDate" TIMESTAMP(3),
ADD COLUMN     "probationEvaluated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "bankAccountId" TEXT;

-- CreateTable
CREATE TABLE "lease_contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "counterparty" TEXT,
    "monthlyRent" DECIMAL(18,2),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_contracts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "lease_contracts" ADD CONSTRAINT "lease_contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_contracts" ADD CONSTRAINT "lease_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
