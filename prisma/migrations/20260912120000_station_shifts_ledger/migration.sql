-- CreateEnum
CREATE TYPE "StationFuelProduct" AS ENUM ('DIESEL', 'GASOLINE_91', 'GASOLINE_95');

-- CreateEnum
CREATE TYPE "StationMeterType" AS ENUM ('MECHANICAL', 'ELECTRONIC');

-- CreateEnum
CREATE TYPE "StationShiftType" AS ENUM ('MORNING', 'NIGHT');

-- CreateEnum
CREATE TYPE "StationShiftStatus" AS ENUM ('OPEN', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'POSTED', 'REJECTED');

-- AlterEnum
ALTER TYPE "SourceModule" ADD VALUE 'station_shift';

-- CreateTable
CREATE TABLE "station_nozzles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "product" "StationFuelProduct" NOT NULL,
    "pumpNumber" INTEGER NOT NULL,
    "nozzleNumber" INTEGER NOT NULL,
    "meterDigits" INTEGER NOT NULL,
    "meterType" "StationMeterType" NOT NULL,
    "hasMoneyMeter" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_nozzles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_prices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "product" "StationFuelProduct" NOT NULL,
    "priceInclVat" DECIMAL(18,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "costCenterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_shifts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "employeeUserId" TEXT NOT NULL,
    "shiftDate" TIMESTAMP(3) NOT NULL,
    "shiftType" "StationShiftType" NOT NULL,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "status" "StationShiftStatus" NOT NULL DEFAULT 'OPEN',
    "rejectionReasonCode" TEXT,
    "rejectionNote" TEXT,
    "reviewedByUserId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_shift_readings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "nozzleId" TEXT NOT NULL,
    "openingReading" DECIMAL(18,3) NOT NULL,
    "closingReading" DECIMAL(18,3) NOT NULL,
    "testLiters" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "ocrValue" DECIMAL(18,3),
    "workerConfirmedValue" DECIMAL(18,3) NOT NULL,
    "accountantConfirmedValue" DECIMAL(18,3),
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_shift_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_shift_credit_sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_shift_credit_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_shift_expenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_shift_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_shift_collections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "networkAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fuelCardAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashDelivered" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_shift_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tank_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "product" "StationFuelProduct" NOT NULL,
    "liters" DECIMAL(18,3) NOT NULL,
    "supplierInvoiceRef" TEXT,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tank_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tank_dips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "product" "StationFuelProduct" NOT NULL,
    "measuredLiters" DECIMAL(18,3) NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tank_dips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_shift_audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "fieldName" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_shift_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "station_nozzles_tenantId_companyId_costCenterId_idx" ON "station_nozzles"("tenantId", "companyId", "costCenterId");

-- CreateIndex
CREATE INDEX "fuel_prices_tenantId_companyId_product_effectiveFrom_idx" ON "fuel_prices"("tenantId", "companyId", "product", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "station_shifts_journalEntryId_key" ON "station_shifts"("journalEntryId");

-- CreateIndex
CREATE INDEX "station_shifts_tenantId_companyId_costCenterId_shiftDate_idx" ON "station_shifts"("tenantId", "companyId", "costCenterId", "shiftDate");

-- CreateIndex
CREATE INDEX "station_shifts_tenantId_companyId_status_idx" ON "station_shifts"("tenantId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "station_shifts_costCenterId_shiftDate_shiftType_key" ON "station_shifts"("costCenterId", "shiftDate", "shiftType");

-- CreateIndex
CREATE INDEX "station_shift_readings_tenantId_companyId_nozzleId_idx" ON "station_shift_readings"("tenantId", "companyId", "nozzleId");

-- CreateIndex
CREATE UNIQUE INDEX "station_shift_readings_shiftId_nozzleId_key" ON "station_shift_readings"("shiftId", "nozzleId");

-- CreateIndex
CREATE INDEX "station_shift_credit_sales_tenantId_companyId_shiftId_idx" ON "station_shift_credit_sales"("tenantId", "companyId", "shiftId");

-- CreateIndex
CREATE INDEX "station_shift_credit_sales_customerId_idx" ON "station_shift_credit_sales"("customerId");

-- CreateIndex
CREATE INDEX "station_shift_expenses_tenantId_companyId_shiftId_idx" ON "station_shift_expenses"("tenantId", "companyId", "shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "station_shift_collections_shiftId_key" ON "station_shift_collections"("shiftId");

-- CreateIndex
CREATE INDEX "tank_deliveries_tenantId_companyId_costCenterId_deliveredAt_idx" ON "tank_deliveries"("tenantId", "companyId", "costCenterId", "deliveredAt");

-- CreateIndex
CREATE INDEX "tank_dips_tenantId_companyId_costCenterId_measuredAt_idx" ON "tank_dips"("tenantId", "companyId", "costCenterId", "measuredAt");

-- CreateIndex
CREATE INDEX "station_shift_audit_logs_tenantId_companyId_shiftId_idx" ON "station_shift_audit_logs"("tenantId", "companyId", "shiftId");

-- AddForeignKey
ALTER TABLE "station_nozzles" ADD CONSTRAINT "station_nozzles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_nozzles" ADD CONSTRAINT "station_nozzles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_nozzles" ADD CONSTRAINT "station_nozzles_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shifts" ADD CONSTRAINT "station_shifts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shifts" ADD CONSTRAINT "station_shifts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shifts" ADD CONSTRAINT "station_shifts_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shifts" ADD CONSTRAINT "station_shifts_employeeUserId_fkey" FOREIGN KEY ("employeeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shifts" ADD CONSTRAINT "station_shifts_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shifts" ADD CONSTRAINT "station_shifts_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_readings" ADD CONSTRAINT "station_shift_readings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_readings" ADD CONSTRAINT "station_shift_readings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_readings" ADD CONSTRAINT "station_shift_readings_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "station_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_readings" ADD CONSTRAINT "station_shift_readings_nozzleId_fkey" FOREIGN KEY ("nozzleId") REFERENCES "station_nozzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_credit_sales" ADD CONSTRAINT "station_shift_credit_sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_credit_sales" ADD CONSTRAINT "station_shift_credit_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_credit_sales" ADD CONSTRAINT "station_shift_credit_sales_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "station_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_credit_sales" ADD CONSTRAINT "station_shift_credit_sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_expenses" ADD CONSTRAINT "station_shift_expenses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_expenses" ADD CONSTRAINT "station_shift_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_expenses" ADD CONSTRAINT "station_shift_expenses_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "station_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_collections" ADD CONSTRAINT "station_shift_collections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_collections" ADD CONSTRAINT "station_shift_collections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_collections" ADD CONSTRAINT "station_shift_collections_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "station_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_deliveries" ADD CONSTRAINT "tank_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_deliveries" ADD CONSTRAINT "tank_deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_deliveries" ADD CONSTRAINT "tank_deliveries_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_dips" ADD CONSTRAINT "tank_dips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_dips" ADD CONSTRAINT "tank_dips_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_dips" ADD CONSTRAINT "tank_dips_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_audit_logs" ADD CONSTRAINT "station_shift_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_audit_logs" ADD CONSTRAINT "station_shift_audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_audit_logs" ADD CONSTRAINT "station_shift_audit_logs_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "station_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shift_audit_logs" ADD CONSTRAINT "station_shift_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

