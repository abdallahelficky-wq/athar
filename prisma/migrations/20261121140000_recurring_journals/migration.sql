-- القيود الدورية (schema.prisma: RecurringJournalTemplate/Line/Run). أسماء الجداول الفعلية (@@map):
-- recurring_journal_templates، recurring_journal_template_lines، recurring_journal_runs.

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('monthly', 'quarterly', 'semiannual', 'yearly');

-- CreateTable
CREATE TABLE "recurring_journal_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memo" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextRunDate" TIMESTAMP(3),
    "autoPost" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_journal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journal_template_lines" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "description" TEXT,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "recurring_journal_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journal_runs" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodDate" TIMESTAMP(3) NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_journal_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_journal_templates_tenantId_companyId_idx" ON "recurring_journal_templates"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "recurring_journal_templates_active_nextRunDate_idx" ON "recurring_journal_templates"("active", "nextRunDate");

-- CreateIndex
CREATE INDEX "recurring_journal_template_lines_templateId_lineNo_idx" ON "recurring_journal_template_lines"("templateId", "lineNo");

-- CreateIndex
CREATE INDEX "recurring_journal_template_lines_tenantId_companyId_idx" ON "recurring_journal_template_lines"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_journal_runs_journalEntryId_key" ON "recurring_journal_runs"("journalEntryId");

-- CreateIndex
CREATE INDEX "recurring_journal_runs_tenantId_companyId_idx" ON "recurring_journal_runs"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_journal_runs_templateId_periodDate_key" ON "recurring_journal_runs"("templateId", "periodDate");

-- AddForeignKey
ALTER TABLE "recurring_journal_templates" ADD CONSTRAINT "recurring_journal_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_templates" ADD CONSTRAINT "recurring_journal_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_template_lines" ADD CONSTRAINT "recurring_journal_template_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "recurring_journal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_template_lines" ADD CONSTRAINT "recurring_journal_template_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_template_lines" ADD CONSTRAINT "recurring_journal_template_lines_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_runs" ADD CONSTRAINT "recurring_journal_runs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "recurring_journal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_runs" ADD CONSTRAINT "recurring_journal_runs_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
