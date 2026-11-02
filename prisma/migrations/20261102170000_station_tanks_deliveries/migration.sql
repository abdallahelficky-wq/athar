-- موديول الخزانات والتوريد: خزانات المحطات، قراءاتها (يدوية الآن، وجهاز آلي لاحقاً)، توريد الوقود، ربط الفوهة بخزانها،
-- وسماحية فروقات الخزانات على الشركة. كلها إضافية؛ لا تمسّ أي صف قائم. جدولا tank_deliveries/tank_dips القديمان غير
-- المستخدَمين يبقيان كما هما (لا حذف هنا).
-- CreateEnum
CREATE TYPE "TankReadingSource" AS ENUM ('manual_dip', 'atg');

-- CreateEnum
CREATE TYPE "TankReadingPurpose" AS ENUM ('opening', 'closing', 'pre_delivery', 'post_delivery', 'spot');

-- CreateEnum
CREATE TYPE "FuelDeliveryStatus" AS ENUM ('confirmed', 'void');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "tankVarianceLitersTolerance" DECIMAL(18,3) NOT NULL DEFAULT 50,
ADD COLUMN     "tankVariancePctTolerance" DECIMAL(6,3) NOT NULL DEFAULT 0.5;

-- AlterTable
ALTER TABLE "station_nozzles" ADD COLUMN     "tankId" TEXT;

-- CreateTable
CREATE TABLE "station_tanks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "product" "StationFuelProduct" NOT NULL,
    "capacityLiters" DECIMAL(18,3) NOT NULL,
    "atgTankNumber" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_tanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tank_readings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "source" "TankReadingSource" NOT NULL,
    "purpose" "TankReadingPurpose" NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "liters" DECIMAL(18,3) NOT NULL,
    "heightMm" DECIMAL(12,2),
    "waterHeightMm" DECIMAL(12,2),
    "waterLiters" DECIMAL(18,3),
    "temperatureC" DECIMAL(6,2),
    "tcLiters" DECIMAL(18,3),
    "ullageLiters" DECIMAL(18,3),
    "density" DECIMAL(10,4),
    "massKg" DECIMAL(18,3),
    "alarms" JSONB,
    "deviceId" TEXT,
    "externalId" TEXT,
    "rawPayload" JSONB,
    "note" TEXT,
    "enteredByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tank_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "supplierId" TEXT,
    "carrierSupplierId" TEXT,
    "deliveryNoteNumber" TEXT NOT NULL,
    "tankerPlate" TEXT,
    "driverName" TEXT,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "status" "FuelDeliveryStatus" NOT NULL DEFAULT 'confirmed',
    "note" TEXT,
    "createdByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_delivery_lines" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "noteLiters" DECIMAL(18,3) NOT NULL,
    "receivedLiters" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "fuel_delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "station_tanks_tenantId_companyId_costCenterId_idx" ON "station_tanks"("tenantId", "companyId", "costCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "station_tanks_costCenterId_code_key" ON "station_tanks"("costCenterId", "code");

-- CreateIndex
CREATE INDEX "tank_readings_tenantId_companyId_tankId_readAt_idx" ON "tank_readings"("tenantId", "companyId", "tankId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "tank_readings_tankId_source_externalId_key" ON "tank_readings"("tankId", "source", "externalId");

-- CreateIndex
CREATE INDEX "fuel_deliveries_tenantId_companyId_costCenterId_deliveredAt_idx" ON "fuel_deliveries"("tenantId", "companyId", "costCenterId", "deliveredAt");

-- CreateIndex
CREATE INDEX "fuel_deliveries_tenantId_companyId_deliveryNoteNumber_idx" ON "fuel_deliveries"("tenantId", "companyId", "deliveryNoteNumber");

-- CreateIndex
CREATE INDEX "fuel_delivery_lines_tankId_idx" ON "fuel_delivery_lines"("tankId");

-- AddForeignKey
ALTER TABLE "station_nozzles" ADD CONSTRAINT "station_nozzles_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "station_tanks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_tanks" ADD CONSTRAINT "station_tanks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_tanks" ADD CONSTRAINT "station_tanks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_tanks" ADD CONSTRAINT "station_tanks_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "station_tanks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_delivery_lines" ADD CONSTRAINT "fuel_delivery_lines_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "fuel_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_delivery_lines" ADD CONSTRAINT "fuel_delivery_lines_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "station_tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
