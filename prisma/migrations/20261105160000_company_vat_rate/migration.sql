-- نسبة ضريبة لكل شركة بحسب دولتها (كانت 15% ثابتة في الكود لكل الدول). الشركات السعودية تبقى 15.
-- المستندات المرحّلة سابقاً لا تتغيّر: النسبة تُطبَّق على ما يُنشأ/يُعدَّل بعد هذا الترحيل فقط.
-- AlterTable
ALTER TABLE "companies" ADD COLUMN "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 15;

UPDATE "companies" SET "vatRate" = CASE "country"
  WHEN 'SA' THEN 15
  WHEN 'AE' THEN 5
  WHEN 'EG' THEN 14
  WHEN 'KW' THEN 0
  WHEN 'QA' THEN 0
  WHEN 'BH' THEN 10
  WHEN 'OM' THEN 5
  WHEN 'JO' THEN 16
  WHEN 'IQ' THEN 0
  WHEN 'DZ' THEN 19
  WHEN 'MA' THEN 20
  WHEN 'TN' THEN 19
  WHEN 'LB' THEN 11
  WHEN 'LY' THEN 0
  WHEN 'SD' THEN 17
  WHEN 'YE' THEN 5
  WHEN 'PS' THEN 16
  ELSE 15
END;
