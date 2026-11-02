-- حساب ذمة فرعي لكل موظف (سلف ومخالفات) تحت مجموعة تُختار في إعدادات الرواتب، وتأجيل قسط سلفة لكشف واحد. أعمدة وجدول جديدان فقط — لا تعديل بيانات.
-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "receivableAccountId" TEXT;

-- AlterTable
ALTER TABLE "payroll_settings" ADD COLUMN     "advancesParentAccountId" TEXT,
ADD COLUMN     "maxInstallmentPercentOfGross" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "payroll_advance_postponements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeAdvanceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_advance_postponements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_advance_postponements_tenantId_companyId_idx" ON "payroll_advance_postponements"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_advance_postponements_payrollRunId_employeeAdvanceI_key" ON "payroll_advance_postponements"("payrollRunId", "employeeAdvanceId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_receivableAccountId_key" ON "employees"("receivableAccountId");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_receivableAccountId_fkey" FOREIGN KEY ("receivableAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_advancesParentAccountId_fkey" FOREIGN KEY ("advancesParentAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_advance_postponements" ADD CONSTRAINT "payroll_advance_postponements_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_advance_postponements" ADD CONSTRAINT "payroll_advance_postponements_employeeAdvanceId_fkey" FOREIGN KEY ("employeeAdvanceId") REFERENCES "employee_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

