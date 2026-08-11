-- إضافة باركود اختياري للصنف، فريد لكل شركة (NULL لا يتعارض مع NULL أخرى في Postgres، فالأصناف
-- بلا باركود لا تتصادم مع بعضها).
ALTER TABLE "items" ADD COLUMN "barcode" TEXT;

CREATE UNIQUE INDEX "items_tenantId_companyId_barcode_key" ON "items"("tenantId", "companyId", "barcode");
