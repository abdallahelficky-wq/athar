-- ورديات المحطات: حالة "reversed" (عكس وردية مرحَّلة)، وتكلفة البضاعة المباعة عند الترحيل — ربط صنف لكل منتج وقود
-- على الشركة، سياسة الرصيد السالب، مستودع لكل محطة، ومصدر حركة الصرف. كلها إضافية (أعمدة فارغة/بقيمة افتراضية)؛
-- لا تمسّ أي صف قائم، والورديات المرحَّلة سابقاً لا تتغيّر.
-- AlterEnum
ALTER TYPE "StationShiftStatus" ADD VALUE 'reversed';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "allowNegativeFuelStock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "stationDieselItemId" TEXT,
ADD COLUMN     "stationGasoline91ItemId" TEXT,
ADD COLUMN     "stationGasoline95ItemId" TEXT;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "sourceStationShiftId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_costCenterId_key" ON "warehouses"("costCenterId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_sourceStationShiftId_idx" ON "stock_movements"("tenantId", "sourceStationShiftId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_stationDieselItemId_fkey" FOREIGN KEY ("stationDieselItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_stationGasoline91ItemId_fkey" FOREIGN KEY ("stationGasoline91ItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_stationGasoline95ItemId_fkey" FOREIGN KEY ("stationGasoline95ItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

