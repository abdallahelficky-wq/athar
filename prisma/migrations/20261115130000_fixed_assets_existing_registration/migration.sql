-- تسجيل "أصل قائم" في سجل الأصول الثابتة بلا قيد شراء جديد (أصل مسجَّل محاسبياً أصلاً في الأستاذ)، مع مجمع إهلاك
-- افتتاحي مُرحَّل في الدفاتر. أعمدة بقيم افتراضية آمنة: لا تغيير لأي أصل قائم في السجل (isExisting=false، 0، NULL).
ALTER TABLE "fixed_assets" ADD COLUMN "isExisting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fixed_assets" ADD COLUMN "openingAccumulatedDepreciation" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fixed_assets" ADD COLUMN "openingDepreciationAsOf" TIMESTAMP(3);
