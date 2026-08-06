ALTER TABLE "companies"
  ADD COLUMN "expenseIncreaseThreshold" DECIMAL(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN "receivablesThreshold" DECIMAL(18,2);
