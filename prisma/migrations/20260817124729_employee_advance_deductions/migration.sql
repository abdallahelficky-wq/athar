-- CreateTable
CREATE TABLE "employee_advance_deductions" (
    "id" TEXT NOT NULL,
    "employeeAdvanceId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_advance_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_advance_deductions_employeeAdvanceId_payrollRunId_key" ON "employee_advance_deductions"("employeeAdvanceId", "payrollRunId");

-- AddForeignKey
ALTER TABLE "employee_advance_deductions" ADD CONSTRAINT "employee_advance_deductions_employeeAdvanceId_fkey" FOREIGN KEY ("employeeAdvanceId") REFERENCES "employee_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_deductions" ADD CONSTRAINT "employee_advance_deductions_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

