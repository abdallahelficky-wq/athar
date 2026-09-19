-- يخزّن الشكل الخام لشهادة CSID تماماً كما أعادته زاتكا في binarySecurityToken (بلا أي فك ترميز
-- إضافي)، منفصلاً عن الحقل القائم (complianceCertEnc/productionCertEnc) الذي يخزّن الشكل القانوني
-- (canonical) المُستخدَم للتوقيع فقط — عطل إنتاج فعلي مؤكَّد: تطبيع الشهادة (فك ترميز base64 إضافي
-- لإصلاح التوقيع) غيَّر أيضاً قيمة ترويسة Basic Auth عن الشكل الذي أصدرته زاتكا بالضبط، فرفضتها
-- بوابتها بـ401 فارغ الجسم. راجع credentials.ts للاحتياطي على الحقل القديم عند NULL (صفوف قديمة
-- سبقت هذا التعديل).
ALTER TABLE "company_zatca_credentials"
  ADD COLUMN "complianceCertRawEnc" TEXT,
  ADD COLUMN "productionCertRawEnc" TEXT;
