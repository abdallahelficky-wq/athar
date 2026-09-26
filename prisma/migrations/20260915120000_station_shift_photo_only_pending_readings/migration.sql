-- AlterTable
ALTER TABLE "station_shift_readings" ALTER COLUMN "closingReading" DROP NOT NULL,
ALTER COLUMN "workerConfirmedValue" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "station_nozzles_costCenterId_pumpNumber_nozzleNumber_key" ON "station_nozzles"("costCenterId", "pumpNumber", "nozzleNumber");
