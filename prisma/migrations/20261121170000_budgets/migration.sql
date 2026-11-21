-- الموازنات التقديرية (schema.prisma: Budget/BudgetLine). أسماء الجداول الفعلية (@@map): budgets، budget_lines.

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('draft', 'approved');

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMonth" TIMESTAMP(3) NOT NULL,
    "costCenterId" TEXT,
    "status" "BudgetStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "m01" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m02" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m03" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m04" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m05" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m06" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m07" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m08" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m09" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m10" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m11" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "m12" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_tenantId_companyId_startMonth_idx" ON "budgets"("tenantId", "companyId", "startMonth");

-- CreateIndex
CREATE INDEX "budget_lines_tenantId_companyId_idx" ON "budget_lines"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_budgetId_accountId_key" ON "budget_lines"("budgetId", "accountId");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
