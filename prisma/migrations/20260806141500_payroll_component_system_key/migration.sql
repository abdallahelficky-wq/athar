-- مفتاح ثابت للبنود النظامية (isSystem) يسمح لسكريبت backfillPayrollComponents.ts وصيغ البنود
-- الأخرى بإيجاد بند نظامي بعينه لكل شركة بشكل صامد أمام إعادة التسمية لاحقاً.

-- AlterTable
ALTER TABLE "payroll_components" ADD COLUMN     "systemKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payroll_components_companyId_systemKey_key" ON "payroll_components"("companyId", "systemKey");
