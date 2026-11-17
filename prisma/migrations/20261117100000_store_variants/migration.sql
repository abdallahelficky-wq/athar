-- خيارات المنتج في المتجر (لون/مقاس): أصناف مستقلة تُجمَّع للعرض برمز مجموعة.
ALTER TABLE "items" ADD COLUMN "storeVariantGroup" TEXT;
ALTER TABLE "items" ADD COLUMN "storeVariantColor" TEXT;
ALTER TABLE "items" ADD COLUMN "storeVariantSize" TEXT;
CREATE INDEX "items_companyId_storeVariantGroup_idx" ON "items"("companyId", "storeVariantGroup");
