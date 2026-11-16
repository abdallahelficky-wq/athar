-- المتجر الإلكتروني العام: حسابات العملاء (دخول برمز لمرة واحدة على الجوال) وطلباتهم. جداول جديدة فقط وعمود عدّاد
-- واحد على الشركة بقيمة افتراضية — لا تغيير لأي بيانات قائمة.
CREATE TYPE "StoreOrderStatus" AS ENUM ('new', 'confirmed', 'completed', 'cancelled');

ALTER TABLE "companies" ADD COLUMN "storeNextOrderSeq" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "store_customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "city" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_otps" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_otps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "notes" TEXT,
    "status" "StoreOrderStatus" NOT NULL DEFAULT 'new',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "vat" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_order_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "priceExVat" DECIMAL(18,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    CONSTRAINT "store_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_customers_companyId_phone_key" ON "store_customers"("companyId", "phone");
CREATE INDEX "store_otps_companyId_phone_createdAt_idx" ON "store_otps"("companyId", "phone", "createdAt");
CREATE INDEX "store_otps_ip_createdAt_idx" ON "store_otps"("ip", "createdAt");
CREATE UNIQUE INDEX "store_orders_companyId_number_key" ON "store_orders"("companyId", "number");
CREATE INDEX "store_orders_companyId_createdAt_idx" ON "store_orders"("companyId", "createdAt");
CREATE INDEX "store_orders_customerId_idx" ON "store_orders"("customerId");
CREATE INDEX "store_order_lines_orderId_idx" ON "store_order_lines"("orderId");

ALTER TABLE "store_customers" ADD CONSTRAINT "store_customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_customers" ADD CONSTRAINT "store_customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_otps" ADD CONSTRAINT "store_otps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_otps" ADD CONSTRAINT "store_otps_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "store_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "store_order_lines" ADD CONSTRAINT "store_order_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_order_lines" ADD CONSTRAINT "store_order_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_order_lines" ADD CONSTRAINT "store_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
