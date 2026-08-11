-- أتمتة إرسال التقارير المالية الدورية (ميزان المراجعة/قائمة الدخل/المركز المالي/التقرير
-- الشهري الشامل) بالبريد الإلكتروني لمدير الحسابات — هجرة إضافية بحتة: enum + جدول جديدان
-- فقط، بلا أي تغيير على جداول موجودة.

-- CreateEnum
CREATE TYPE "ReportScheduleFrequency" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "frequency" "ReportScheduleFrequency" NOT NULL DEFAULT 'monthly',
    "dayOfWeek" INTEGER NOT NULL DEFAULT 0,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "hourUtc" INTEGER NOT NULL DEFAULT 6,
    "includeComprehensiveMonthly" BOOLEAN NOT NULL DEFAULT true,
    "includeTrialBalance" BOOLEAN NOT NULL DEFAULT true,
    "includeIncomeStatement" BOOLEAN NOT NULL DEFAULT true,
    "includeBalanceSheet" BOOLEAN NOT NULL DEFAULT true,
    "recipientEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "lastSentPeriodKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_schedules_companyId_key" ON "report_schedules"("companyId");

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
