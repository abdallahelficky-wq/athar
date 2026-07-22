/*
  Warnings:

  - You are about to drop the column `account` on the `purchase_invoice_lines` table. All the data in the column will be lost.
  - You are about to drop the column `account` on the `purchase_return_lines` table. All the data in the column will be lost.
  - You are about to drop the column `account` on the `sales_invoice_lines` table. All the data in the column will be lost.
  - You are about to drop the column `account` on the `sales_return_lines` table. All the data in the column will be lost.
  - Added the required column `accountId` to the `purchase_invoice_lines` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `purchase_return_lines` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `sales_invoice_lines` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `sales_return_lines` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "purchase_invoice_lines" DROP COLUMN "account",
ADD COLUMN     "accountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "purchase_return_lines" DROP COLUMN "account",
ADD COLUMN     "accountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sales_invoice_lines" DROP COLUMN "account",
ADD COLUMN     "accountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sales_return_lines" DROP COLUMN "account",
ADD COLUMN     "accountId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "station_sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "liters" DECIMAL(18,3) NOT NULL,
    "pricePerLiter" DECIMAL(18,4) NOT NULL,
    "shiftNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_sales_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_sales" ADD CONSTRAINT "station_sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_sales" ADD CONSTRAINT "station_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_sales" ADD CONSTRAINT "station_sales_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
