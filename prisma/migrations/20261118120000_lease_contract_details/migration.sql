-- بيانات عقد الإيجار التفصيلية (رقم العقد، الإبرام، القيمة، الضمان، الشروط الإضافية، التجديد ومهلة الإشعار، بيانات المؤجر والعقار). كلها إضافية.
-- AlterTable
ALTER TABLE "lease_contracts" ADD COLUMN "contractNumber" TEXT,
ADD COLUMN "signedOn" TIMESTAMP(3),
ADD COLUMN "contractValue" DECIMAL(18,2),
ADD COLUMN "depositAmount" DECIMAL(18,2),
ADD COLUMN "customTerms" TEXT,
ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "noticeDays" INTEGER,
ADD COLUMN "lessorDetails" JSONB,
ADD COLUMN "propertyDetails" JSONB;
