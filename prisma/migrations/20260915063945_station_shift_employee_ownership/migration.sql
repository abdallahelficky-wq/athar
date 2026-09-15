/*
  Warnings:

  - You are about to drop the column `employeeUserId` on the `station_shifts` table. All the data in the column will be lost.
  - You are about to drop the column `assignedCostCenterId` on the `users` table. All the data in the column will be lost.
  - Added the required column `employeeId` to the `station_shifts` table without a default value. This is not possible if the table is not empty.

  Note: this migration only touches what this change actually modifies (Employee/User/StationShift
  ownership). Two unrelated statements the raw `prisma migrate dev` diff produced — a
  boarding_contracts foreign key drop/recreate and a trainer_commissions index rename — were
  removed; confirmed via `prisma migrate diff` against the unmodified schema that they are
  pre-existing drift on this branch, unrelated to this change, and are left for whoever owns
  that drift to address separately.
*/
-- DropForeignKey
ALTER TABLE "station_shifts" DROP CONSTRAINT "station_shifts_employeeUserId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_assignedCostCenterId_fkey";

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "assignedCostCenterId" TEXT;

-- AlterTable
ALTER TABLE "station_shifts" DROP COLUMN "employeeUserId",
ADD COLUMN     "employeeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "assignedCostCenterId";

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_assignedCostCenterId_fkey" FOREIGN KEY ("assignedCostCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_shifts" ADD CONSTRAINT "station_shifts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
