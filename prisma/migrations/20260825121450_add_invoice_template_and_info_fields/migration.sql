-- CreateEnum
CREATE TYPE "InvoiceTemplate" AS ENUM ('modern', 'classicPro');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "invoiceTemplate" "InvoiceTemplate" NOT NULL DEFAULT 'modern',
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "nameEn" TEXT,
ADD COLUMN     "unifiedEntityNumber" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "unifiedEntityNumber" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "customerReference" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "otherId" TEXT,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "salesperson" TEXT;

