-- استقبال رسائل PTS-2 (jsonPTS): مفتاح التوقيع المشفَّر وفرق التوقيت وآخر إعداد على المتحكم، وجدول تنبيهات المتحكم. كلها إضافية.
-- AlterTable
ALTER TABLE "forecourt_controllers" ADD COLUMN "secretKeyEnc" TEXT,
ADD COLUMN "secretKeySetAt" TIMESTAMP(3),
ADD COLUMN "utcOffsetMinutes" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN "protocolRevision" TEXT,
ADD COLUMN "configurationId" TEXT,
ADD COLUMN "lastConfiguration" JSONB,
ADD COLUMN "lastConfigurationAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "forecourt_alert_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deviceType" TEXT NOT NULL,
    "deviceNumber" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sensor" INTEGER,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecourt_alert_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forecourt_alert_dedup_key" ON "forecourt_alert_records"("controllerId", "occurredAt", "deviceType", "deviceNumber", "code", "state");
CREATE INDEX "forecourt_alert_records_tenantId_companyId_occurredAt_idx" ON "forecourt_alert_records"("tenantId", "companyId", "occurredAt");

-- AddForeignKey
ALTER TABLE "forecourt_alert_records" ADD CONSTRAINT "forecourt_alert_records_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "forecourt_controllers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
