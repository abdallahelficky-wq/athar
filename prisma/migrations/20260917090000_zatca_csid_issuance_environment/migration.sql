-- يُسجِّل بيئة زاتكا (sandbox/simulation/production) الفعلية وقت إصدار كل شهادة CSID، منفصلة تماماً
-- عن company.zatcaEnvironment الحالي الذي قد يتغيّر لاحقاً — عطل إنتاج فعلي مؤكَّد: شهادة اختبار
-- صادرة بـOTP حقيقي من بوابة فاتورة بينما بيئة الشركة كانت مضبوطة على sandbox (بوابة مطورين عامة
-- ببيانات وهمية منفصلة تماماً لا تعرف هذه الشهادة إطلاقاً) — 401 مضمون بلا أي علاقة بصحة التوقيع.
-- NULL للصفوف القديمة السابقة لهذا التعديل عمداً — يُفتَرض عندها تطابق البيئة الحالية، لا إنذار كاذب.
ALTER TABLE "company_zatca_credentials"
  ADD COLUMN "complianceCsidEnvironment" "ZatcaEnvironment",
  ADD COLUMN "productionCsidEnvironment" "ZatcaEnvironment";
