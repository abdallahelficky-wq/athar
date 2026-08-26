-- AlterEnum
ALTER TYPE "BusinessActivity" ADD VALUE 'horse_stables';

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'suspended';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "enabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "suspensionReason" TEXT;

-- CreateTable
CREATE TABLE "platform_notices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_notices_tenantId_idx" ON "platform_notices"("tenantId");

-- AddForeignKey
ALTER TABLE "platform_notices" ADD CONSTRAINT "platform_notices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

