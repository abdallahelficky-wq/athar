-- المتجر الإلكتروني العام: إعدادات المتجر على الشركة وحقول عرض الصنف. أعمدة جديدة فقط، والقيم الافتراضية
-- (storeEnabled/publishedInStore = false) تُبقي كل شركة وكل صنف قائم غير ظاهر للعموم حتى يُفعَّل صراحةً.
ALTER TABLE "companies" ADD COLUMN "storeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "storeSlug" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeName" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeNameEn" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeWhatsappNumber" TEXT;
CREATE UNIQUE INDEX "companies_storeSlug_key" ON "companies"("storeSlug");

ALTER TABLE "items" ADD COLUMN "publishedInStore" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN "storeDescription" TEXT;
ALTER TABLE "items" ADD COLUMN "storeDescriptionEn" TEXT;
ALTER TABLE "items" ADD COLUMN "countryOfOrigin" TEXT;
CREATE INDEX "items_companyId_publishedInStore_idx" ON "items"("companyId", "publishedInStore");
