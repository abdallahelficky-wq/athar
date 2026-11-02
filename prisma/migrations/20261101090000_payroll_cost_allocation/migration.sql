-- تحميل تكلفة الرواتب على قسم/مركز تكلفة الموظف، وبند مساهمة صاحب العمل (مطفأ افتراضياً). إضافة أعمدة فقط — لا تعديل بيانات.
-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "costCenterId" TEXT,
ADD COLUMN     "departmentId" TEXT;

-- AlterTable
ALTER TABLE "payroll_components" ADD COLUMN     "contraAccountId" TEXT;

-- AlterTable
ALTER TABLE "payroll_settings" ADD COLUMN     "employerContributionsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_contraAccountId_fkey" FOREIGN KEY ("contraAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

