-- الزكاة (schema.prisma: ZakatDeclaration، Account.zakatTreatment، Company.zakatMethod/zakatableOwnershipPct).
-- أسماء الجداول الفعلية (@@map): zakat_declarations، accounts، companies، journal_entries.

-- CreateEnum
CREATE TYPE "ZakatMethod" AS ENUM ('regulation_1445', 'net_current_assets');

-- CreateEnum
CREATE TYPE "ZakatTreatment" AS ENUM ('equity', 'non_current_liability', 'current_liability', 'deductible_non_current_asset', 'non_deductible_non_current_asset', 'deductible_current_asset', 'current_asset', 'excluded');

-- CreateEnum
CREATE TYPE "ZakatDeclarationStatus" AS ENUM ('draft', 'posted');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "zakatTreatment" "ZakatTreatment";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "zakatMethod" "ZakatMethod" NOT NULL DEFAULT 'regulation_1445',
ADD COLUMN "zakatableOwnershipPct" DECIMAL(5,2) NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "zakat_declarations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "hijriYear" BOOLEAN NOT NULL DEFAULT false,
    "method" "ZakatMethod" NOT NULL,
    "zakatableOwnershipPct" DECIMAL(5,2) NOT NULL,
    "adjustments" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "zakatDue" DECIMAL(18,2) NOT NULL,
    "status" "ZakatDeclarationStatus" NOT NULL DEFAULT 'draft',
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zakat_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zakat_declarations_journalEntryId_key" ON "zakat_declarations"("journalEntryId");

-- CreateIndex
CREATE INDEX "zakat_declarations_tenantId_companyId_periodEnd_idx" ON "zakat_declarations"("tenantId", "companyId", "periodEnd");

-- AddForeignKey
ALTER TABLE "zakat_declarations" ADD CONSTRAINT "zakat_declarations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakat_declarations" ADD CONSTRAINT "zakat_declarations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zakat_declarations" ADD CONSTRAINT "zakat_declarations_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
