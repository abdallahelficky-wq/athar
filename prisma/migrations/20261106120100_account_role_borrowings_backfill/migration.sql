-- منفصل عن إضافة القيمة: Postgres لا يسمح باستخدام قيمة enum جديدة في نفس المعاملة التي أضافتها.
-- التعبئة تصنيف نظامي لا تعديل مستخدم: لا تُسجَّل في سجل التدقيق.
ALTER TABLE "accounts" DISABLE TRIGGER "accounts_record_change";

UPDATE "accounts" SET "analysisRole" = 'borrowings'
WHERE "analysisRole" IS NULL AND "type" = 'liability'
  AND "name" ~ '(قرض|قروض|تسهيلات بنكية|تسهيلات ائتمانية|تمويل بنكي|مرابحة|تورق)';

ALTER TABLE "accounts" ENABLE TRIGGER "accounts_record_change";
