CREATE TABLE "annual_leave_drafts" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
 "createdBy" TEXT NOT NULL, "request" JSONB NOT NULL, "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "annual_leave_drafts_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "annual_leave_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "annual_leave_drafts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "annual_leave_drafts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "annual_leave_drafts_tenantId_companyId_idx" ON "annual_leave_drafts"("tenantId", "companyId");
