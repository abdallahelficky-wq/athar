-- حالة عقد الإيجار (ساري/معلّق/موقوف/منتهٍ) مع سببها وتاريخها وسجلها. أعمدة جديدة فقط.
-- العقود غير السارية القائمة (isActive = false) تصبح «منتهية» حتى تبقى الحالة مطابقة لـ isActive.
-- CreateEnum
CREATE TYPE "LeaseContractStatus" AS ENUM ('active', 'suspended', 'stopped', 'ended');

-- AlterTable
ALTER TABLE "lease_contracts" ADD COLUMN "status" "LeaseContractStatus" NOT NULL DEFAULT 'active',
ADD COLUMN "statusReason" TEXT,
ADD COLUMN "statusDate" TIMESTAMP(3),
ADD COLUMN "statusHistory" JSONB;

UPDATE "lease_contracts" SET "status" = 'ended' WHERE "isActive" = false;
