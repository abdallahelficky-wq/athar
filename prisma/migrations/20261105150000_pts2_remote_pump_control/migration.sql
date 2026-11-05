-- التحكم بالمضخات عن بُعد عبر اتصال WebSocket الدائم مع PTS-2: وقت آخر اتصال/انقطاع على المتحكم، وسجل الأوامر المرسلة إليه
-- (تشغيل مضخة بمبلغ/لترات، إيقاف) بنتيجتها ومن أرسلها. كلها إضافية.
-- CreateEnum
CREATE TYPE "ForecourtCommandType" AS ENUM ('pump_authorize', 'pump_stop', 'pump_emergency_stop');

-- CreateEnum
CREATE TYPE "ForecourtCommandStatus" AS ENUM ('pending', 'confirmed', 'rejected', 'timeout', 'offline');

-- AlterTable
ALTER TABLE "forecourt_controllers" ADD COLUMN "wsConnectedAt" TIMESTAMP(3),
ADD COLUMN "wsDisconnectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "forecourt_commands" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "type" "ForecourtCommandType" NOT NULL,
    "ptsPump" INTEGER NOT NULL,
    "ptsNozzle" INTEGER,
    "presetType" TEXT,
    "dose" DECIMAL(14,3),
    "price" DECIMAL(14,3),
    "status" "ForecourtCommandStatus" NOT NULL DEFAULT 'pending',
    "transactionNumber" INTEGER,
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "requestPayload" JSONB NOT NULL,
    "responsePayload" JSONB,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "forecourt_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forecourt_commands_tenantId_companyId_createdAt_idx" ON "forecourt_commands"("tenantId", "companyId", "createdAt");
CREATE INDEX "forecourt_commands_controllerId_createdAt_idx" ON "forecourt_commands"("controllerId", "createdAt");

-- AddForeignKey
ALTER TABLE "forecourt_commands" ADD CONSTRAINT "forecourt_commands_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "forecourt_controllers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
