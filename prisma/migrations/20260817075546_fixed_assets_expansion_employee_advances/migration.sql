-- CreateEnum
CREATE TYPE "FixedAssetDepreciationMethod" AS ENUM ('straight_line', 'declining_balance');

-- CreateEnum
CREATE TYPE "EmployeeAdvanceStatus" AS ENUM ('active', 'settled');

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_companyId_fkey";

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_parentId_fkey";

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "isFixedAssetAccount" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- assetNumber يُضاف Nullable أولاً ثم يُعبَّأ رجعياً قبل فرض NOT NULL — لا توجد أصول ثابتة حقيقية
-- مسجَّلة في أي شركة إنتاج وقت هذا التعديل (مؤكَّد)، لكن قواعد تطوير محلية قد تحوي بيانات تجريبية
-- قديمة، فالتعبئة الرجعية هنا احتراز عام يطابق نفس نمط "nullable ثم backfill ثم NOT NULL"
-- المستخدَم فعلاً في هذا المشروع (professional_chart_of_accounts، zatca_phase2_foundation).
ALTER TABLE "fixed_assets" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "assetNumber" TEXT,
ADD COLUMN     "chassisNumber" TEXT,
ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "depreciationMethod" "FixedAssetDepreciationMethod" NOT NULL DEFAULT 'straight_line',
ADD COLUMN     "isDepreciable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "serialNumber" TEXT,
ADD COLUMN     "sourceJournalEntryLineId" TEXT;

-- Backfill: رقم أصل تسلسلي per-company لأي صفوف موجودة بالفعل (تجريبية محلياً فقط).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt") AS rn
  FROM "fixed_assets"
)
UPDATE "fixed_assets" f
SET "assetNumber" = 'AST-' || LPAD(numbered.rn::text, 5, '0')
FROM numbered
WHERE f.id = numbered.id;

ALTER TABLE "fixed_assets" ALTER COLUMN "assetNumber" SET NOT NULL;

-- AlterTable
ALTER TABLE "journal_entry_lines" ADD COLUMN     "employeeAdvanceId" TEXT,
ADD COLUMN     "fixedAssetId" TEXT;

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "monthlyInstallment" DECIMAL(18,2),
    "remainingBalance" DECIMAL(18,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "EmployeeAdvanceStatus" NOT NULL DEFAULT 'active',
    "employeePayrollComponentId" TEXT,
    "sourceJournalEntryLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_employeePayrollComponentId_key" ON "employee_advances"("employeePayrollComponentId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_sourceJournalEntryLineId_key" ON "employee_advances"("sourceJournalEntryLineId");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_sourceJournalEntryLineId_key" ON "fixed_assets"("sourceJournalEntryLineId");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_tenantId_companyId_assetNumber_key" ON "fixed_assets"("tenantId", "companyId", "assetNumber");

-- CreateIndex
CREATE INDEX "journal_entry_lines_fixedAssetId_idx" ON "journal_entry_lines"("fixedAssetId");

-- CreateIndex
CREATE INDEX "journal_entry_lines_employeeAdvanceId_idx" ON "journal_entry_lines"("employeeAdvanceId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_employeeAdvanceId_fkey" FOREIGN KEY ("employeeAdvanceId") REFERENCES "employee_advances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employeePayrollComponentId_fkey" FOREIGN KEY ("employeePayrollComponentId") REFERENCES "employee_payroll_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

