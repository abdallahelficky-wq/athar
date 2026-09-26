-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "stationCashShortageAccountId" TEXT,
ADD COLUMN     "stationCashSurplusAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_stationCashShortageAccountId_fkey" FOREIGN KEY ("stationCashShortageAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_stationCashSurplusAccountId_fkey" FOREIGN KEY ("stationCashSurplusAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

