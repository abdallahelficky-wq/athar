-- موديول الإيجارات: شروط سداد على عقد الإيجار، جدول دفعات، وإطفاء شهري للإيجار المدفوع مقدماً، ومصدرا قيد جديدان. كلها إضافية.
-- AlterEnum
ALTER TYPE "SourceModule" ADD VALUE 'lease_payment';
ALTER TYPE "SourceModule" ADD VALUE 'lease_amortization';

-- CreateEnum
CREATE TYPE "LeaseVatMode" AS ENUM ('none', 'inclusive');

-- CreateEnum
CREATE TYPE "LeasePaymentStatus" AS ENUM ('due', 'paid', 'waived');

-- AlterTable
ALTER TABLE "lease_contracts" ADD COLUMN "costCenterId" TEXT,
ADD COLUMN "vatMode" "LeaseVatMode" NOT NULL DEFAULT 'none',
ADD COLUMN "paymentAmount" DECIMAL(18,2),
ADD COLUMN "paymentEveryMonths" INTEGER,
ADD COLUMN "firstDueDate" TIMESTAMP(3),
ADD COLUMN "expenseAccountId" TEXT,
ADD COLUMN "prepaidAccountId" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "lease_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leaseContractId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "status" "LeasePaymentStatus" NOT NULL DEFAULT 'due',
    "paidOn" TIMESTAMP(3),
    "bankAccountId" TEXT,
    "postedExternally" BOOLEAN NOT NULL DEFAULT false,
    "amortizeFromMonth" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "journalEntryId" TEXT,
    "lastReversalEntryId" TEXT,
    "paidByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_amortization_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_amortization_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_amortization_lines" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "leasePaymentId" TEXT NOT NULL,
    "leaseContractId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "lease_amortization_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lease_payments_tenantId_companyId_dueDate_idx" ON "lease_payments"("tenantId", "companyId", "dueDate");

-- CreateIndex
CREATE INDEX "lease_payments_leaseContractId_idx" ON "lease_payments"("leaseContractId");

-- CreateIndex
CREATE UNIQUE INDEX "lease_amortization_runs_companyId_month_key" ON "lease_amortization_runs"("companyId", "month");

-- CreateIndex
CREATE INDEX "lease_amortization_lines_leasePaymentId_idx" ON "lease_amortization_lines"("leasePaymentId");

-- CreateIndex
CREATE INDEX "lease_amortization_lines_runId_idx" ON "lease_amortization_lines"("runId");

-- AddForeignKey
ALTER TABLE "lease_payments" ADD CONSTRAINT "lease_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_payments" ADD CONSTRAINT "lease_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_payments" ADD CONSTRAINT "lease_payments_leaseContractId_fkey" FOREIGN KEY ("leaseContractId") REFERENCES "lease_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_amortization_runs" ADD CONSTRAINT "lease_amortization_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_amortization_runs" ADD CONSTRAINT "lease_amortization_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_amortization_lines" ADD CONSTRAINT "lease_amortization_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "lease_amortization_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_amortization_lines" ADD CONSTRAINT "lease_amortization_lines_leasePaymentId_fkey" FOREIGN KEY ("leasePaymentId") REFERENCES "lease_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
