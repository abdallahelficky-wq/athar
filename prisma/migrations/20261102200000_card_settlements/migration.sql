-- تسويات الشبكة (مدى) وبطاقات الوقود: مصدر قيد جديد، حساب عمولات البنك على الشركة، وجدول التسويات. كلها إضافية.
-- AlterEnum
ALTER TYPE "SourceModule" ADD VALUE 'card_settlement';

-- CreateEnum
CREATE TYPE "CardSettlementChannel" AS ENUM ('network', 'fuel_card');
CREATE TYPE "CardSettlementStatus" AS ENUM ('posted', 'reversed');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "cardFeeExpenseAccountId" TEXT;

-- CreateTable
CREATE TABLE "card_settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "channel" "CardSettlementChannel" NOT NULL,
    "salesFrom" TEXT NOT NULL,
    "salesTo" TEXT NOT NULL,
    "settledOn" TIMESTAMP(3) NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "expectedAmount" DECIMAL(18,2) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "feeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feeVatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "shiftCount" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "note" TEXT,
    "journalEntryId" TEXT,
    "status" "CardSettlementStatus" NOT NULL DEFAULT 'posted',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reverseReason" TEXT,
    "reversalEntryId" TEXT,

    CONSTRAINT "card_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_settlements_tenantId_companyId_costCenterId_channel_salesFrom_idx" ON "card_settlements"("tenantId", "companyId", "costCenterId", "channel", "salesFrom");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_cardFeeExpenseAccountId_fkey" FOREIGN KEY ("cardFeeExpenseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
