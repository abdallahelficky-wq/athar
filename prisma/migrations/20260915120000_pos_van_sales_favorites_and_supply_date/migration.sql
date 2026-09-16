-- 1) أصناف "مفضّلة" (وصول سريع) لكل مستودع مندوب مبيعات — راجع تعليق PosFavoriteItem في schema.prisma
CREATE TABLE "pos_favorite_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_favorite_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_favorite_items_warehouseId_itemId_key" ON "pos_favorite_items"("warehouseId", "itemId");
CREATE INDEX "pos_favorite_items_tenantId_companyId_idx" ON "pos_favorite_items"("tenantId", "companyId");

ALTER TABLE "pos_favorite_items" ADD CONSTRAINT "pos_favorite_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_favorite_items" ADD CONSTRAINT "pos_favorite_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_favorite_items" ADD CONSTRAINT "pos_favorite_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_favorite_items" ADD CONSTRAINT "pos_favorite_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) تاريخ توريد مستقل عن تاريخ الإصدار (راجع تعليق الحقل في schema.prisma) — يُضاف NULL مبدئياً،
-- يُعبَّى بمطابقة تاريخ الإصدار الحالي لكل الفواتير الموجودة (لا فرق سلوكي لأي فاتورة قديمة أو أي
-- مسار غير نقطة البيع)، ثم يُفرَض NOT NULL.
ALTER TABLE "sales_invoices" ADD COLUMN "supplyDate" TIMESTAMP(3);
UPDATE "sales_invoices" SET "supplyDate" = "date";
ALTER TABLE "sales_invoices" ALTER COLUMN "supplyDate" SET NOT NULL;

-- 3) أقصى عدد أيام تراجع مسموح بها لتاريخ التوريد عن تاريخ الإصدار — راجع تعليق الحقل في schema.prisma
ALTER TABLE "companies" ADD COLUMN "posSupplyDateMaxBackdatingDays" INTEGER NOT NULL DEFAULT 3;
