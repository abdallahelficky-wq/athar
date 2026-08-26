ALTER TABLE "employees"
  ADD COLUMN "employeeNumber" TEXT,
  ADD COLUMN "idNumber" TEXT,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "maritalStatus" TEXT,
  ADD COLUMN "workLocation" TEXT,
  ADD COLUMN "personalEmail" TEXT,
  ADD COLUMN "workEmail" TEXT,
  ADD COLUMN "alternatePhone" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT,
  ADD COLUMN "emergencyContactRelation" TEXT,
  ADD COLUMN "medicalInsuranceProvider" TEXT,
  ADD COLUMN "medicalInsuranceNumber" TEXT,
  ADD COLUMN "annualLeaveDays" INTEGER NOT NULL DEFAULT 21,
  ADD COLUMN "notes" TEXT;

CREATE UNIQUE INDEX "employees_companyId_employeeNumber_key"
  ON "employees"("companyId", "employeeNumber");
