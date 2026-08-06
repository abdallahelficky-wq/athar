-- إعدادات الرواتب المرنة (Phase H) — هجرة إضافية بحتة: جداول جديدة بالكامل + عمود اختياري
-- جديد على hr_actions (componentId، nullable مؤقتاً حتى تكتمل التعبئة الرجعية عبر
-- scripts/backfillPayrollComponents.ts). لا تغيير على أي جدول/عمود موجود بخلاف ذلك، ولا أي
-- تأثير على منطق الرواتب الحالي قبل تشغيل الـ backfill وإعادة كتابة postPayrollRun.

-- CreateTable
CREATE TABLE "payroll_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "calcMethod" TEXT NOT NULL,
    "formula" JSONB,
    "adjustmentUnitBasis" JSONB,
    "allowsMonthlyAdjustments" BOOLEAN NOT NULL DEFAULT true,
    "prorateOnPartialMonth" BOOLEAN NOT NULL DEFAULT true,
    "sourceEmployeeField" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "appliesByDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payroll_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "fixedValue" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_payroll_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "standardHoursPerMonth" DECIMAL(6,2) NOT NULL DEFAULT 240,
    "standardDaysPerMonth" DECIMAL(6,2) NOT NULL DEFAULT 30,
    "payslipColumns" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "hr_actions" ADD COLUMN     "componentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "employee_payroll_components_employeeId_componentId_key" ON "employee_payroll_components"("employeeId", "componentId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_settings_companyId_key" ON "payroll_settings"("companyId");

-- AddForeignKey
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payroll_components" ADD CONSTRAINT "employee_payroll_components_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payroll_components" ADD CONSTRAINT "employee_payroll_components_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payroll_components" ADD CONSTRAINT "employee_payroll_components_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "payroll_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_actions" ADD CONSTRAINT "hr_actions_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "payroll_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;
