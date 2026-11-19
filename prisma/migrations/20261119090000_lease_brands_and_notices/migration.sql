-- العلامات التجارية لعقود الإيجار، وخطابات الإشعار للمؤجر. جداول وأعمدة جديدة فقط.
-- CreateEnum
CREATE TYPE "LeaseNoticeKind" AS ENUM ('renewal', 'termination');

-- AlterTable
ALTER TABLE "lease_contracts" ADD COLUMN "brandId" TEXT;

-- CreateTable
CREATE TABLE "lease_brands" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_notices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leaseContractId" TEXT NOT NULL,
    "kind" "LeaseNoticeKind" NOT NULL,
    "letterDate" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipientEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lease_contracts_brandId_idx" ON "lease_contracts"("brandId");
CREATE UNIQUE INDEX "lease_brands_companyId_name_key" ON "lease_brands"("companyId", "name");
CREATE INDEX "lease_notices_leaseContractId_idx" ON "lease_notices"("leaseContractId");

-- AddForeignKey
ALTER TABLE "lease_contracts" ADD CONSTRAINT "lease_contracts_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "lease_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lease_brands" ADD CONSTRAINT "lease_brands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_brands" ADD CONSTRAINT "lease_brands_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_notices" ADD CONSTRAINT "lease_notices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_notices" ADD CONSTRAINT "lease_notices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_notices" ADD CONSTRAINT "lease_notices_leaseContractId_fkey" FOREIGN KEY ("leaseContractId") REFERENCES "lease_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
