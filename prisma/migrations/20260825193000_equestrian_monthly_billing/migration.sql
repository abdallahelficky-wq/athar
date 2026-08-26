ALTER TYPE "BusinessActivity" ADD VALUE IF NOT EXISTS 'horse_stables';

ALTER TABLE "horses" ADD COLUMN "ownerEmail" TEXT;
ALTER TABLE "horses" ADD COLUMN "ownerNationalId" TEXT;
ALTER TABLE "horses" ADD COLUMN "customerId" TEXT;
ALTER TABLE "riding_trainers" ADD COLUMN "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 5;
ALTER TABLE "riding_lessons" ADD COLUMN "studentEmail" TEXT;
ALTER TABLE "riding_lessons" ADD COLUMN "customerId" TEXT;
ALTER TABLE "riding_lessons" ADD COLUMN "salesInvoiceId" TEXT;
ALTER TABLE "horse_care_services" ADD COLUMN "revenueAccountId" TEXT;

ALTER TABLE "horses" ADD CONSTRAINT "horses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "horse_care_services" ADD CONSTRAINT "horse_care_services_revenueAccountId_fkey" FOREIGN KEY ("revenueAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "riding_lessons" ADD CONSTRAINT "riding_lessons_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "riding_lessons" ADD CONSTRAINT "riding_lessons_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "riding_lessons_salesInvoiceId_key" ON "riding_lessons"("salesInvoiceId");

CREATE TABLE "horse_monthly_services" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "horseId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "trainerId" TEXT,
  "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(18,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "horse_monthly_services_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "horses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "horse_monthly_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "horse_care_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "horse_monthly_services_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "riding_trainers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "horse_monthly_services_horseId_serviceId_key" ON "horse_monthly_services"("horseId", "serviceId");
CREATE INDEX "horse_monthly_services_tenantId_companyId_isActive_idx" ON "horse_monthly_services"("tenantId", "companyId", "isActive");

CREATE TABLE "horse_boarding_invoices" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "billingMonth" TIMESTAMP(3) NOT NULL,
  "salesInvoiceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "horse_boarding_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "horse_boarding_invoices_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "horse_boarding_invoices_salesInvoiceId_key" ON "horse_boarding_invoices"("salesInvoiceId");
CREATE UNIQUE INDEX "horse_boarding_invoices_companyId_customerId_billingMonth_key" ON "horse_boarding_invoices"("companyId", "customerId", "billingMonth");
CREATE INDEX "horse_boarding_invoices_tenantId_companyId_billingMonth_idx" ON "horse_boarding_invoices"("tenantId", "companyId", "billingMonth");

CREATE TABLE "horse_boarding_invoice_lines" (
  "id" TEXT PRIMARY KEY,
  "boardingInvoiceId" TEXT NOT NULL,
  "horseId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "trainerId" TEXT,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unitPrice" DECIMAL(18,2) NOT NULL,
  "netAmount" DECIMAL(18,2) NOT NULL,
  "vatAmount" DECIMAL(18,2) NOT NULL,
  "totalAmount" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "horse_boarding_invoice_lines_boardingInvoiceId_fkey" FOREIGN KEY ("boardingInvoiceId") REFERENCES "horse_boarding_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "horse_boarding_invoice_lines_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "horses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "horse_boarding_invoice_lines_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "horse_care_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "horse_boarding_invoice_lines_boardingInvoiceId_horseId_idx" ON "horse_boarding_invoice_lines"("boardingInvoiceId", "horseId");

CREATE TYPE "TrainerCommissionStatus" AS ENUM ('accrued', 'paid', 'cancelled');
CREATE TABLE "trainer_commissions" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "trainerId" TEXT NOT NULL,
  "horseId" TEXT,
  "lessonId" TEXT,
  "sourceType" TEXT NOT NULL DEFAULT 'horse_training',
  "salesInvoiceId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "netTrainingRevenue" DECIMAL(18,2) NOT NULL,
  "commissionPct" DECIMAL(5,2) NOT NULL,
  "commissionAmount" DECIMAL(18,2) NOT NULL,
  "status" "TrainerCommissionStatus" NOT NULL DEFAULT 'accrued',
  "accrualJournalEntryId" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trainer_commissions_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "riding_trainers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "trainer_commissions_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "horses"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "trainer_commissions_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "riding_lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "trainer_commissions_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "trainer_commissions_trainerId_salesInvoiceId_horseId_key" ON "trainer_commissions"("trainerId", "salesInvoiceId", "horseId");
CREATE INDEX "trainer_commissions_tenantId_companyId_periodStart_periodEnd_idx" ON "trainer_commissions"("tenantId", "companyId", "periodStart", "periodEnd");
