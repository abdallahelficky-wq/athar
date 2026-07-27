-- AlterTable
ALTER TABLE "sales_invoice_lines" ADD COLUMN     "sellableItemId" TEXT,
ADD COLUMN     "vatApplicable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "sellable_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultUnitPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vatApplicable" BOOLEAN NOT NULL DEFAULT true,
    "defaultRevenueAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellable_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sellable_items_tenantId_companyId_name_key" ON "sellable_items"("tenantId", "companyId", "name");

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_sellableItemId_fkey" FOREIGN KEY ("sellableItemId") REFERENCES "sellable_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellable_items" ADD CONSTRAINT "sellable_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellable_items" ADD CONSTRAINT "sellable_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellable_items" ADD CONSTRAINT "sellable_items_defaultRevenueAccountId_fkey" FOREIGN KEY ("defaultRevenueAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
