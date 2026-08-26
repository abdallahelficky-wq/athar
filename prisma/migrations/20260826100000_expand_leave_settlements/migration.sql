ALTER TABLE "leave_settlements"
  ADD COLUMN "leaveEndDate" TIMESTAMP(3),
  ADD COLUMN "settlementType" TEXT NOT NULL DEFAULT 'actual_leave',
  ADD COLUMN "leaveDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN "usedLeaveDaysBefore" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN "remainingLeaveDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN "leaveBalanceAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "leavePayAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "payroll_settings"
  ADD COLUMN "leaveDaysBeforeFive" DECIMAL(6,2) NOT NULL DEFAULT 21,
  ADD COLUMN "leaveDaysAfterFive" DECIMAL(6,2) NOT NULL DEFAULT 30,
  ADD COLUMN "leaveDailyRateDivisor" DECIMAL(6,2) NOT NULL DEFAULT 30,
  ADD COLUMN "leaveSalaryBasis" TEXT NOT NULL DEFAULT 'total',
  ADD COLUMN "eosSalaryBasis" TEXT NOT NULL DEFAULT 'basic_housing';
