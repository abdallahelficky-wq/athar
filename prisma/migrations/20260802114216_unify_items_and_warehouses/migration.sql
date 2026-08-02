-- ============================================================================
-- توحيد "الأصناف" (دمج items القديم مع sellable_items) + بناء نموذج Warehouse حقيقي
-- منفصل عن CostCenter + محرك متوسط تكلفة مرجّح لحظي + ربط الأصناف بفواتير الشراء/البيع.
--
-- الترتيب مهم جداً هنا: نضيف الأعمدة/الجداول الجديدة أولاً (كلها اختيارية/بقيم افتراضية)،
-- نملأ البيانات القديمة، ثم نحذف الجداول/الأعمدة/القيود القديمة، ثم نضيف قيود NOT NULL/الفهارس
-- النهائية — بحيث لا تنكسر أي قناة بيانات في أي خطوة وسيطة.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) إضافة الأعمدة/الأنواع الجديدة (بدون كسر أي شيء قائم)
-- ---------------------------------------------------------------------------

CREATE TYPE "ItemType" AS ENUM ('inventory', 'expense', 'service', 'fixed_asset', 'raw_material', 'bundle');

ALTER TABLE "items"
  ADD COLUMN "type" "ItemType" NOT NULL DEFAULT 'inventory',
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "averageCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "lastPurchasePrice" DECIMAL(18,4),
  ADD COLUMN "salePrice" DECIMAL(18,4),
  ADD COLUMN "vatApplicable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "stockAccountId" TEXT,
  ADD COLUMN "cogsAccountId" TEXT,
  ADD COLUMN "revenueAccountId" TEXT,
  ADD COLUMN "expenseAccountId" TEXT,
  ADD COLUMN "allowDirectSale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "assetCategory" TEXT;

ALTER TABLE "fixed_assets" ADD COLUMN "sourcePurchaseInvoiceLineId" TEXT;

ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN "itemId" TEXT,
  ADD COLUMN "warehouseId" TEXT,
  ADD COLUMN "usefulLifeYears" INTEGER,
  ADD COLUMN "salvageValue" DECIMAL(18,2);

ALTER TABLE "sales_invoice_lines" ADD COLUMN "itemId" TEXT;

ALTER TABLE "stock_movements"
  ADD COLUMN "sourcePurchaseInvoiceLineId" TEXT,
  ADD COLUMN "sourceSalesInvoiceLineId" TEXT;

CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "location" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "item_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentItemId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "quantityPerUnit" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_components_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 2) ترحيل البيانات القديمة
-- ---------------------------------------------------------------------------

-- 2.1 بذرة محرك التكلفة: نبدأ المتوسط المرجّح من نفس القيمة اليدوية القديمة (لا صفر)
UPDATE "items" SET "averageCost" = "costPrice", "lastPurchasePrice" = "costPrice";

-- 2.2 ربط محاسبي أفضل جهد (best-effort) للأصناف القديمة بالحسابات القياسية القائمة فعلياً
--     في شجرة كل شركة — يبقى NULL لو الشركة معندهاش حساب بهذا الاسم بالضبط كحساب ترحيل
--     نشط (الواجهة هتوضّح "بيانات الصنف غير مكتملة" وتمنع ترحيل معاملات جديدة عليه لحد ما
--     يُستكمَل يدوياً، من غير ما يأثر على أي قيد/رصيد تاريخي قائم).
UPDATE "items" i SET "stockAccountId" = a."id"
FROM "accounts" a
WHERE a."tenantId" = i."tenantId" AND a."companyId" = i."companyId"
  AND a."name" IN ('مخزون بضائع', 'المخزون') AND a."isPosting" = true AND a."isArchived" = false AND a."isActive" = true;

UPDATE "items" i SET "cogsAccountId" = a."id"
FROM "accounts" a
WHERE a."tenantId" = i."tenantId" AND a."companyId" = i."companyId"
  AND a."name" IN ('تكلفة البضاعة المباعة', 'تكلفة البضاعة المباعة / الصرف المخزني') AND a."isPosting" = true AND a."isArchived" = false AND a."isActive" = true;

UPDATE "items" i SET "revenueAccountId" = a."id"
FROM "accounts" a
WHERE a."tenantId" = i."tenantId" AND a."companyId" = i."companyId"
  AND a."name" IN ('إيرادات المبيعات', 'إيرادات النشاط الرئيسي') AND a."isPosting" = true AND a."isArchived" = false AND a."isActive" = true;

-- 2.3 نسخ sellable_items (كتالوج مبيعات منفصل قديماً) إلى items كصنف نوعه "خدمي" — النوع
--     الوحيد اللي سلوكه يطابق تماماً ما كان عليه SellableItem (بدون مخزون/COGS، إيراد فقط)،
--     وده يحافظ ١٠٠٪ على نفس سلوك القيود القديمة بلا أي تغيير. الكود بيتولّد تلقائياً لأن
--     SellableItem مكانش ليه كود أصلاً. الـ id بيتحافظ عليه حرفياً عشان أي FK قديم يشاور
--     عليه (sales_invoice_lines.sellableItemId) يفضل صحيح من غير أي إعادة ربط.
INSERT INTO "items" (
  "id", "tenantId", "companyId", "code", "name", "type", "unit", "category", "isArchived",
  "costPrice", "averageCost", "lastPurchasePrice", "salePrice", "vatApplicable", "reorderLevel",
  "stockAccountId", "cogsAccountId", "revenueAccountId", "expenseAccountId",
  "allowDirectSale", "assetCategory", "createdAt", "updatedAt"
)
-- الكود يُشتق من معرّف الصنف نفسه (cuid فريد عالمياً) لا من ترقيم تسلسلي لكل شركة: القيد
-- الفريد النشط في هذه اللحظة بالذات هو "items_tenantId_code_key" (على مستوى المستأجر كله،
-- يُحذَف لاحقاً في القسم 3) لا "لكل شركة" — أي ترقيم يعيد البدء من ١ لكل شركة (زي
-- ROW_NUMBER() PARTITION BY companyId) يُنتِج كوداً مكرراً بين شركتين لنفس المستأجر
-- (مثلاً SV-00001 مرتين) فتفشل هذه الخطوة وتتوقف الهجرة بالكامل.
SELECT
  s."id", s."tenantId", s."companyId",
  'SVC-' || s."id",
  s."name", 'service', NULL, NULL, false,
  0, 0, NULL, s."defaultUnitPrice", s."vatApplicable", NULL,
  NULL, NULL, s."defaultRevenueAccountId", NULL,
  false, NULL, s."createdAt", s."updatedAt"
FROM "sellable_items" s;

-- 2.4 إعادة ربط سطور فواتير المبيعات: itemId = sellableItemId القديم (نفس القيمة بالضبط،
--     صالحة الآن لأن صف SellableItem المطابق اتنسخ لجدول items بنفس الـ id في الخطوة السابقة)
UPDATE "sales_invoice_lines" SET "itemId" = "sellableItemId" WHERE "sellableItemId" IS NOT NULL;

-- 2.5 مستودعات: ننسخ كل مركز تكلفة مُستخدَم فعلياً كمخزن اليوم (نفس الـ id، عشان
--     stock_movements.warehouseId يفضل صحيح من غير إعادة ربط) — بما فيها مراكز التكلفة
--     "العامة" (companyId فارغ، كان النموذج القديم يسمح باختيارها كمخزن). المستودع الجديد
--     companyId فيه إلزامي، فنشتق شركة افتراضية لهذه الحالة من أول حركة مخزون فعلية تشاور
--     عليها (COALESCE) بدل استبعادها بالكامل — استبعادها كان يترك حركة مخزون قديمة بلا
--     مستودع مطابق، فيفشل قيد "stock_movements_warehouseId_fkey" النهائي وتتوقف الهجرة بالكامل.
INSERT INTO "warehouses" ("id", "tenantId", "companyId", "name", "createdAt", "updatedAt")
SELECT DISTINCT ON (c."id")
  c."id", c."tenantId", COALESCE(c."companyId", sm."companyId"), c."name", c."createdAt", c."updatedAt"
FROM "cost_centers" c
JOIN "stock_movements" sm ON sm."warehouseId" = c."id"
ORDER BY c."id", sm."companyId";

-- 2.6 لأي شركة معندهاش أي حركة مخزون سابقة (ومن ثم معندهاش مستودع اتنسخ في الخطوة اللي فاتت)،
--     ننشئ مستودع افتراضي واحد باسم "المستودع الرئيسي"
INSERT INTO "warehouses" ("id", "tenantId", "companyId", "name", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."tenantId", c."id", 'المستودع الرئيسي', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."companyId" = c."id");

-- 2.7 لكل شركة عندها مستودعات (منسوخة من مراكز تكلفة) بس من غير أي مستودع افتراضي محدد
--     بعد، نعيّن أول واحد (بترتيب الإنشاء) كافتراضي — مطلوب لخصم مخزون المبيعات تلقائياً
UPDATE "warehouses" w SET "isDefault" = true
WHERE w."id" IN (
  SELECT DISTINCT ON ("companyId") "id"
  FROM "warehouses"
  WHERE "companyId" NOT IN (SELECT "companyId" FROM "warehouses" WHERE "isDefault" = true)
  ORDER BY "companyId", "createdAt" ASC
);

-- ---------------------------------------------------------------------------
-- 3) حذف الجداول/الأعمدة/القيود القديمة اللي بقت غير مستخدمة
-- ---------------------------------------------------------------------------

ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "sales_invoice_lines_sellableItemId_fkey";
ALTER TABLE "sales_invoice_lines" DROP COLUMN "sellableItemId";

ALTER TABLE "sellable_items" DROP CONSTRAINT "sellable_items_companyId_fkey";
ALTER TABLE "sellable_items" DROP CONSTRAINT "sellable_items_defaultRevenueAccountId_fkey";
ALTER TABLE "sellable_items" DROP CONSTRAINT "sellable_items_tenantId_fkey";
DROP TABLE "sellable_items";

ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_warehouseId_fkey";

DROP INDEX "items_tenantId_code_key";

-- ---------------------------------------------------------------------------
-- 4) الفهارس والقيود النهائية
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "items_tenantId_companyId_code_key" ON "items"("tenantId", "companyId", "code");
CREATE INDEX "items_tenantId_companyId_type_idx" ON "items"("tenantId", "companyId", "type");

CREATE UNIQUE INDEX "warehouses_tenantId_companyId_name_key" ON "warehouses"("tenantId", "companyId", "name");
CREATE UNIQUE INDEX "item_components_parentItemId_componentItemId_key" ON "item_components"("parentItemId", "componentItemId");
CREATE UNIQUE INDEX "fixed_assets_sourcePurchaseInvoiceLineId_key" ON "fixed_assets"("sourcePurchaseInvoiceLineId");
CREATE UNIQUE INDEX "stock_movements_sourcePurchaseInvoiceLineId_key" ON "stock_movements"("sourcePurchaseInvoiceLineId");
CREATE UNIQUE INDEX "stock_movements_sourceSalesInvoiceLineId_key" ON "stock_movements"("sourceSalesInvoiceLineId");

ALTER TABLE "items" ADD CONSTRAINT "items_stockAccountId_fkey" FOREIGN KEY ("stockAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_cogsAccountId_fkey" FOREIGN KEY ("cogsAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_revenueAccountId_fkey" FOREIGN KEY ("revenueAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "item_components" ADD CONSTRAINT "item_components_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_components" ADD CONSTRAINT "item_components_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_components" ADD CONSTRAINT "item_components_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
