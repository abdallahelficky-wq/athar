ALTER TABLE "employees" ALTER COLUMN "gosiApplicable" SET DEFAULT false;
ALTER TABLE "employees" ADD COLUMN "gosiEmployeeRate" DECIMAL(5,2), ADD COLUMN "payrollPaymentMethod" TEXT;
ALTER TABLE "payroll_settings" ADD COLUMN "defaultGosiEmployeeRate" DECIMAL(5,2);
ALTER TABLE "payroll_runs" ADD COLUMN "postedSnapshot" JSONB;
ALTER TABLE "employees" ADD CONSTRAINT "employee_gosi_rate_allowed" CHECK ("gosiEmployeeRate" IS NULL OR "gosiEmployeeRate" IN (9.75,10.75));
