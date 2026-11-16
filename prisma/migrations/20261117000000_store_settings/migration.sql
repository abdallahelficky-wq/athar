-- إعدادات المتجر الإلكتروني: المظهر، الشحن، الدفع، التسويق. أعمدة اختيارية أو بقيم افتراضية تُبقي كل متجر وصنف وطلب
-- قائم كما هو، وجدولان جديدان (مناطق الشحن، الكوبونات).
CREATE TYPE "StoreCouponType" AS ENUM ('percent', 'fixed');

ALTER TABLE "companies" ADD COLUMN "storeAccentColor" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeAbout" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeAboutEn" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeSocial" JSONB;
ALTER TABLE "companies" ADD COLUMN "storeMetaPixelId" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeFreeShippingOver" DECIMAL(18,2);
ALTER TABLE "companies" ADD COLUMN "storePickupEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "storePickupAddress" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeCodEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "companies" ADD COLUMN "storeBankTransferEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "storeBankTransferDetails" TEXT;
ALTER TABLE "companies" ADD COLUMN "storeMinOrderAmount" DECIMAL(18,2);
ALTER TABLE "companies" ADD COLUMN "storeReturnPolicy" TEXT;
ALTER TABLE "companies" ADD COLUMN "storePrivacyPolicy" TEXT;

ALTER TABLE "items" ADD COLUMN "storeCompareAtPrice" DECIMAL(18,4);
ALTER TABLE "items" ADD COLUMN "storeFeatured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "store_orders" ADD COLUMN "shippingMethod" TEXT NOT NULL DEFAULT 'delivery';
ALTER TABLE "store_orders" ADD COLUMN "shippingFee" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "store_orders" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'unspecified';
ALTER TABLE "store_orders" ADD COLUMN "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "store_orders" ADD COLUMN "couponCode" TEXT;

CREATE TABLE "store_shipping_zones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "fee" DECIMAL(18,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_shipping_zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_coupons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "StoreCouponType" NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "minOrderAmount" DECIMAL(18,2),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_shipping_zones_companyId_city_key" ON "store_shipping_zones"("companyId", "city");
CREATE UNIQUE INDEX "store_coupons_companyId_code_key" ON "store_coupons"("companyId", "code");

ALTER TABLE "store_shipping_zones" ADD CONSTRAINT "store_shipping_zones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_shipping_zones" ADD CONSTRAINT "store_shipping_zones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_coupons" ADD CONSTRAINT "store_coupons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_coupons" ADD CONSTRAINT "store_coupons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
