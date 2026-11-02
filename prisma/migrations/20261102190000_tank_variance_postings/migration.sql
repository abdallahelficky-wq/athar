-- ترحيل فروقات مطابقة الخزانات: مصدر قيد جديد، حساب الفروقات على الشركة، وجدول الترحيلات. كلها إضافية.
-- AlterEnum
ALTER TYPE "SourceModule" ADD VALUE 'station_tank_variance';

-- CreateEnum
CREATE TYPE "TankVariancePostingStatus" AS ENUM ('posted', 'reversed');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "tankVarianceAccountId" TEXT;

-- CreateTable
CREATE TABLE "tank_variance_postings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "openingReadingId" TEXT NOT NULL,
    "closingReadingId" TEXT NOT NULL,
    "openingAt" TIMESTAMP(3) NOT NULL,
    "closingAt" TIMESTAMP(3) NOT NULL,
    "openingLiters" DECIMAL(18,3) NOT NULL,
    "closingLiters" DECIMAL(18,3) NOT NULL,
    "receivedLiters" DECIMAL(18,3) NOT NULL,
    "soldLiters" DECIMAL(18,3) NOT NULL,
    "expectedLiters" DECIMAL(18,3) NOT NULL,
    "varianceLiters" DECIMAL(18,3) NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "journalEntryId" TEXT,
    "stockMovementId" TEXT,
    "status" "TankVariancePostingStatus" NOT NULL DEFAULT 'posted',
    "note" TEXT,
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reverseReason" TEXT,
    "reversalEntryId" TEXT,

    CONSTRAINT "tank_variance_postings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tank_variance_postings_tenantId_companyId_tankId_closingAt_idx" ON "tank_variance_postings"("tenantId", "companyId", "tankId", "closingAt");

-- ترحيل قائم واحد فقط لكل (خزان، قراءة إقفال) — يمنع ترحيلين متزامنين لنفس الفترة
CREATE UNIQUE INDEX "tank_variance_postings_live_closing_key" ON "tank_variance_postings"("tankId", "closingReadingId") WHERE "status" = 'posted';

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tankVarianceAccountId_fkey" FOREIGN KEY ("tankVarianceAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tank_variance_postings" ADD CONSTRAINT "tank_variance_postings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tank_variance_postings" ADD CONSTRAINT "tank_variance_postings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tank_variance_postings" ADD CONSTRAINT "tank_variance_postings_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "station_tanks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- شركات محطات الوقود القائمة: ربط حساب الفروقات بـ«فاقد وعجز قياس الخزانات» (511004) من شجرتها إن وُجد حساب ترحيل نشط
UPDATE "companies" c SET "tankVarianceAccountId" = a."id"
FROM "accounts" a
WHERE c."businessActivity" = 'fuel_stations' AND c."tankVarianceAccountId" IS NULL
  AND a."companyId" = c."id" AND a."tenantId" = c."tenantId" AND a."code" = '511004'
  AND a."isPosting" = true AND a."isActive" = true AND a."isArchived" = false;
