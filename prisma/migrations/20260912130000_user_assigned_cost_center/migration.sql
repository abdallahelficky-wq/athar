-- AlterTable
ALTER TABLE "users" ADD COLUMN     "assignedCostCenterId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_assignedCostCenterId_fkey" FOREIGN KEY ("assignedCostCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

