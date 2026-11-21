-- الشيكات (schema.prisma: Cheque/ChequeEvent، Company.chequesReceivableAccountId/chequesPayableAccountId، SourceModule.cheque).
-- أسماء الجداول الفعلية (@@map): cheques، cheque_events، companies، customers، suppliers، accounts، journal_entries.

-- AlterEnum
ALTER TYPE "SourceModule" ADD VALUE 'cheque';

-- CreateEnum
CREATE TYPE "ChequeDirection" AS ENUM ('received', 'issued');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('pending', 'cleared', 'bounced', 'cancelled');

-- CreateEnum
CREATE TYPE "ChequeEventType" AS ENUM ('registered', 'cleared', 'bounced', 'cancelled');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "chequesReceivableAccountId" TEXT,
ADD COLUMN "chequesPayableAccountId" TEXT;

-- CreateTable
CREATE TABLE "cheques" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" "ChequeDirection" NOT NULL,
    "chequeNumber" TEXT NOT NULL,
    "bankName" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "counterAccountId" TEXT NOT NULL,
    "partyName" TEXT,
    "memo" TEXT,
    "status" "ChequeStatus" NOT NULL DEFAULT 'pending',
    "bankAccountId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_events" (
    "id" TEXT NOT NULL,
    "chequeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ChequeEventType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "journalEntryId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheque_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cheques_tenantId_companyId_direction_status_dueDate_idx" ON "cheques"("tenantId", "companyId", "direction", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "cheque_events_journalEntryId_key" ON "cheque_events"("journalEntryId");

-- CreateIndex
CREATE INDEX "cheque_events_chequeId_createdAt_idx" ON "cheque_events"("chequeId", "createdAt");

-- CreateIndex
CREATE INDEX "cheque_events_tenantId_companyId_idx" ON "cheque_events"("tenantId", "companyId");

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_counterAccountId_fkey" FOREIGN KEY ("counterAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
