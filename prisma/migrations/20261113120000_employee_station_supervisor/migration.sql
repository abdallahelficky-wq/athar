-- مشرف المحطات: موظف يرى من بوابة الجوال كل محطات شركته حيّة (قراءة فقط)
ALTER TABLE "employees" ADD COLUMN "stationSupervisor" BOOLEAN NOT NULL DEFAULT false;

-- رسائل مشرف المحطات لعمّال محطة: تُرسَل لمحطة فيراها كل عامل مُسنَد لها في التطبيق
CREATE TABLE "station_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "fromEmployeeId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "seenByEmployeeId" TEXT,
    CONSTRAINT "station_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "station_messages_tenantId_costCenterId_createdAt_idx" ON "station_messages"("tenantId", "costCenterId", "createdAt");
ALTER TABLE "station_messages" ADD CONSTRAINT "station_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "station_messages" ADD CONSTRAINT "station_messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "station_messages" ADD CONSTRAINT "station_messages_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "station_messages" ADD CONSTRAINT "station_messages_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
