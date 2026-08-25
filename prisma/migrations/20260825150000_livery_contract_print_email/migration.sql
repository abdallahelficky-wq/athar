ALTER TABLE "boarding_contracts"
  ADD COLUMN "contractNumber" TEXT,
  ADD COLUMN "ownerName" TEXT,
  ADD COLUMN "ownerNationality" TEXT,
  ADD COLUMN "ownerNationalId" TEXT,
  ADD COLUMN "ownerIdIssuePlace" TEXT,
  ADD COLUMN "ownerPhone" TEXT,
  ADD COLUMN "ownerEmail" TEXT,
  ADD COLUMN "ownerCity" TEXT,
  ADD COLUMN "ownerDistrict" TEXT,
  ADD COLUMN "ownerStreet" TEXT,
  ADD COLUMN "ownerBuildingNo" TEXT,
  ADD COLUMN "ownerPostalCode" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "horses_stallId_key" ON "horses"("stallId");
CREATE UNIQUE INDEX "boarding_contracts_companyId_contractNumber_key" ON "boarding_contracts"("companyId", "contractNumber");
