CREATE TYPE "HorseSex" AS ENUM ('stallion', 'mare', 'gelding');
CREATE TYPE "HorseStatus" AS ENUM ('active', 'training', 'resting', 'medical_hold', 'sold', 'deceased');
CREATE TYPE "StallStatus" AS ENUM ('available', 'occupied', 'maintenance', 'inactive');
CREATE TYPE "BoardingContractStatus" AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE "HorseCareType" AS ENUM ('veterinary', 'vaccination', 'farrier', 'feeding', 'training', 'grooming', 'medication', 'other');

CREATE TABLE "stables" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "code" TEXT, "location" TEXT, "managerName" TEXT,
  "phone" TEXT, "capacity" INTEGER NOT NULL DEFAULT 0, "notes" TEXT,
  "isArchived" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "stables_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "stable_stalls" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "stableId" TEXT NOT NULL,
  "number" TEXT NOT NULL, "type" TEXT, "dailyRate" DECIMAL(18,2), "status" "StallStatus" NOT NULL DEFAULT 'available',
  "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stable_stalls_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "horses" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "stableId" TEXT, "stallId" TEXT,
  "name" TEXT NOT NULL, "registrationNo" TEXT, "microchipNo" TEXT, "breed" TEXT, "color" TEXT,
  "sex" "HorseSex" NOT NULL, "birthDate" TIMESTAMP(3), "ownerName" TEXT, "ownerPhone" TEXT,
  "status" "HorseStatus" NOT NULL DEFAULT 'active', "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "horses_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "boarding_contracts" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "stableId" TEXT NOT NULL,
  "horseId" TEXT NOT NULL, "stallId" TEXT, "startDate" TIMESTAMP(3) NOT NULL, "endDate" TIMESTAMP(3),
  "monthlyFee" DECIMAL(18,2) NOT NULL, "depositAmount" DECIMAL(18,2),
  "status" "BoardingContractStatus" NOT NULL DEFAULT 'active', "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "boarding_contracts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "horse_care_records" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "horseId" TEXT NOT NULL,
  "type" "HorseCareType" NOT NULL, "performedAt" TIMESTAMP(3) NOT NULL, "provider" TEXT,
  "description" TEXT NOT NULL, "cost" DECIMAL(18,2), "nextDueDate" TIMESTAMP(3), "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "horse_care_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stables_companyId_code_key" ON "stables"("companyId", "code");
CREATE INDEX "stables_tenantId_companyId_idx" ON "stables"("tenantId", "companyId");
CREATE UNIQUE INDEX "stable_stalls_stableId_number_key" ON "stable_stalls"("stableId", "number");
CREATE INDEX "stable_stalls_tenantId_companyId_idx" ON "stable_stalls"("tenantId", "companyId");
CREATE UNIQUE INDEX "horses_companyId_registrationNo_key" ON "horses"("companyId", "registrationNo");
CREATE UNIQUE INDEX "horses_companyId_microchipNo_key" ON "horses"("companyId", "microchipNo");
CREATE INDEX "horses_tenantId_companyId_idx" ON "horses"("tenantId", "companyId");
CREATE INDEX "boarding_contracts_tenantId_companyId_status_idx" ON "boarding_contracts"("tenantId", "companyId", "status");
CREATE INDEX "horse_care_records_tenantId_companyId_performedAt_idx" ON "horse_care_records"("tenantId", "companyId", "performedAt");
CREATE INDEX "horse_care_records_horseId_nextDueDate_idx" ON "horse_care_records"("horseId", "nextDueDate");

ALTER TABLE "stables" ADD CONSTRAINT "stables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stables" ADD CONSTRAINT "stables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stable_stalls" ADD CONSTRAINT "stable_stalls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stable_stalls" ADD CONSTRAINT "stable_stalls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stable_stalls" ADD CONSTRAINT "stable_stalls_stableId_fkey" FOREIGN KEY ("stableId") REFERENCES "stables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "horses" ADD CONSTRAINT "horses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "horses" ADD CONSTRAINT "horses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "horses" ADD CONSTRAINT "horses_stableId_fkey" FOREIGN KEY ("stableId") REFERENCES "stables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "horses" ADD CONSTRAINT "horses_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "stable_stalls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boarding_contracts" ADD CONSTRAINT "boarding_contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boarding_contracts" ADD CONSTRAINT "boarding_contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "boarding_contracts" ADD CONSTRAINT "boarding_contracts_stableId_fkey" FOREIGN KEY ("stableId") REFERENCES "stables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boarding_contracts" ADD CONSTRAINT "boarding_contracts_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "horses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boarding_contracts" ADD CONSTRAINT "boarding_contracts_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "stable_stalls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "horse_care_records" ADD CONSTRAINT "horse_care_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "horse_care_records" ADD CONSTRAINT "horse_care_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "horse_care_records" ADD CONSTRAINT "horse_care_records_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "horses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

