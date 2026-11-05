-- الأسماء الإنجليزية للأقسام ومراكز التكلفة والمسميات الوظيفية، وحساب مصروف الرواتب لكل قسم تحميل راتب
ALTER TABLE "departments" ADD COLUMN "nameEn" TEXT;
ALTER TABLE "departments" ADD COLUMN "salaryExpenseAccountId" TEXT;
ALTER TABLE "cost_centers" ADD COLUMN "nameEn" TEXT;
ALTER TABLE "job_titles" ADD COLUMN "nameEn" TEXT;

ALTER TABLE "departments" ADD CONSTRAINT "departments_salaryExpenseAccountId_fkey" FOREIGN KEY ("salaryExpenseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
