-- متحكمات المحطات (PTS-2): تسجيل المتحكم لكل محطة، ربط أرقام المضخات/الفوهات، وعمليات البيع المستقبَلة. إضافية فقط.
-- CreateEnum
CREATE TYPE "ForecourtVendor" AS ENUM ('technotrade_pts2');

-- CreateTable
CREATE TABLE "forecourt_controllers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "vendor" "ForecourtVendor" NOT NULL DEFAULT 'technotrade_pts2',
    "deviceSerial" TEXT NOT NULL,
    "name" TEXT,
    "firmwareVersion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastStatus" JSONB,
    "silentAfterMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forecourt_controllers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecourt_nozzle_maps" (
    "id" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "ptsPump" INTEGER NOT NULL,
    "ptsNozzle" INTEGER NOT NULL,
    "nozzleId" TEXT NOT NULL,

    CONSTRAINT "forecourt_nozzle_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecourt_pump_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "ptsPump" INTEGER NOT NULL,
    "ptsNozzle" INTEGER NOT NULL,
    "nozzleId" TEXT,
    "transactionNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3) NOT NULL,
    "volume" DECIMAL(18,3) NOT NULL,
    "tcVolume" DECIMAL(18,3),
    "amount" DECIMAL(18,2),
    "price" DECIMAL(18,4),
    "totalVolume" DECIMAL(18,3),
    "totalAmount" DECIMAL(18,2),
    "tag" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecourt_pump_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forecourt_controllers_costCenterId_key" ON "forecourt_controllers"("costCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "forecourt_controllers_deviceSerial_key" ON "forecourt_controllers"("deviceSerial");

-- CreateIndex
CREATE INDEX "forecourt_controllers_tenantId_companyId_idx" ON "forecourt_controllers"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "forecourt_nozzle_maps_nozzleId_key" ON "forecourt_nozzle_maps"("nozzleId");

-- CreateIndex
CREATE UNIQUE INDEX "forecourt_nozzle_maps_controllerId_ptsPump_ptsNozzle_key" ON "forecourt_nozzle_maps"("controllerId", "ptsPump", "ptsNozzle");

-- CreateIndex
CREATE INDEX "forecourt_pump_tx_nozzle_idx" ON "forecourt_pump_transactions"("tenantId", "companyId", "nozzleId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "forecourt_pump_tx_dedup_key" ON "forecourt_pump_transactions"("controllerId", "ptsPump", "transactionNumber", "endedAt");

-- AddForeignKey
ALTER TABLE "forecourt_controllers" ADD CONSTRAINT "forecourt_controllers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecourt_controllers" ADD CONSTRAINT "forecourt_controllers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecourt_controllers" ADD CONSTRAINT "forecourt_controllers_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecourt_nozzle_maps" ADD CONSTRAINT "forecourt_nozzle_maps_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "forecourt_controllers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecourt_nozzle_maps" ADD CONSTRAINT "forecourt_nozzle_maps_nozzleId_fkey" FOREIGN KEY ("nozzleId") REFERENCES "station_nozzles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecourt_pump_transactions" ADD CONSTRAINT "forecourt_pump_transactions_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "forecourt_controllers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
