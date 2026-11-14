-- فصل مستخدمي تطبيق المحطات (عمّال ومشرفون) عن شئون الموظفين: جدول station_users مستقل، تُحوَّل إليه تلقائياً كل هوية
-- محطات قائمة (موظف مُسنَد لمحطة، أو مشرف، أو له ورديات أو رسائل) بنفس الجوال وتجزئة الرمز، وتنتقل إليه ورديّاته ورسائله.
-- المعرّف المحوَّل حتمي ('su_' || معرّف الموظف) فيُربط به كل شيء في نفس الترحيل. الموظفون أنفسهم يبقون في شئون الموظفين كما هم.

CREATE TYPE "StationUserRole" AS ENUM ('worker', 'supervisor');

CREATE TABLE "station_users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "role" "StationUserRole" NOT NULL DEFAULT 'worker',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "pinHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lockoutCount" INTEGER NOT NULL DEFAULT 0,
    "migratedFromEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "station_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "station_users_tenantId_phone_key" ON "station_users"("tenantId", "phone");
CREATE INDEX "station_users_tenantId_companyId_idx" ON "station_users"("tenantId", "companyId");
ALTER TABLE "station_users" ADD CONSTRAINT "station_users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "station_users" ADD CONSTRAINT "station_users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "station_users" ADD CONSTRAINT "station_users_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "station_users" ("id", "tenantId", "companyId", "costCenterId", "role", "name", "phone", "pinHash", "active", "archivedAt", "migratedFromEmployeeId", "createdAt", "updatedAt")
SELECT 'su_' || e."id", e."tenantId", e."companyId", e."assignedCostCenterId",
       CASE WHEN e."stationSupervisor" THEN 'supervisor'::"StationUserRole" ELSE 'worker'::"StationUserRole" END,
       e."name", e."phone", e."pinHash", (e."portalActive" AND e."status" = 'active'),
       CASE WHEN e."status" = 'active' THEN NULL ELSE CURRENT_TIMESTAMP END,
       e."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "employees" e
WHERE e."assignedCostCenterId" IS NOT NULL
   OR e."stationSupervisor"
   OR EXISTS (SELECT 1 FROM "station_shifts" s WHERE s."employeeId" = e."id")
   OR EXISTS (SELECT 1 FROM "station_messages" m WHERE m."fromEmployeeId" = e."id");

-- الورديات: صاحبها مستخدم المحطات المحوَّل؛ employeeId يبقى للتاريخ ويصبح اختيارياً
ALTER TABLE "station_shifts" ADD COLUMN "stationUserId" TEXT;
UPDATE "station_shifts" SET "stationUserId" = 'su_' || "employeeId";
ALTER TABLE "station_shifts" ALTER COLUMN "stationUserId" SET NOT NULL;
ALTER TABLE "station_shifts" ALTER COLUMN "employeeId" DROP NOT NULL;
ALTER TABLE "station_shifts" ADD CONSTRAINT "station_shifts_stationUserId_fkey" FOREIGN KEY ("stationUserId") REFERENCES "station_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "station_shifts_stationUserId_idx" ON "station_shifts"("stationUserId");

-- الرسائل: المرسل مستخدم المحطات المحوَّل
ALTER TABLE "station_messages" ADD COLUMN "fromStationUserId" TEXT;
UPDATE "station_messages" SET "fromStationUserId" = 'su_' || "fromEmployeeId";
ALTER TABLE "station_messages" ALTER COLUMN "fromStationUserId" SET NOT NULL;
ALTER TABLE "station_messages" DROP CONSTRAINT "station_messages_fromEmployeeId_fkey";
ALTER TABLE "station_messages" DROP COLUMN "fromEmployeeId";
ALTER TABLE "station_messages" RENAME COLUMN "seenByEmployeeId" TO "seenByStationUserId";
UPDATE "station_messages" SET "seenByStationUserId" = 'su_' || "seenByStationUserId" WHERE "seenByStationUserId" IS NOT NULL;
ALTER TABLE "station_messages" ADD CONSTRAINT "station_messages_fromStationUserId_fkey" FOREIGN KEY ("fromStationUserId") REFERENCES "station_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- علم المشرف انتقل لدور مستخدم المحطات
ALTER TABLE "employees" DROP COLUMN "stationSupervisor";
