-- بوابة الموظف (الجوال): حقول دخول منفصلة على Employee + مفهوم "المدير المباشر"
ALTER TABLE "employees"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "pinHash" TEXT,
  ADD COLUMN "portalActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "failedPortalLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "portalLockedUntil" TIMESTAMP(3),
  ADD COLUMN "managerId" TEXT;

CREATE UNIQUE INDEX "employees_tenantId_phone_key" ON "employees"("tenantId", "phone");

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- حضور الموظف اليومي
CREATE TABLE "attendance_records" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "checkInAt" TIMESTAMP(3),
  "checkOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_records_employeeId_date_key" ON "attendance_records"("employeeId", "date");
CREATE INDEX "attendance_records_tenantId_companyId_date_idx" ON "attendance_records"("tenantId", "companyId", "date");

ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
