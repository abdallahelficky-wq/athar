-- حالة زاتكا جديدة: نجاح فحص امتثال (شركة لا تزال على شهادة اختبار Compliance CSID، لم تحصل على
-- شهادة إنتاج بعد) — لا يجوز الخلط بينها وبين cleared/reported لأن فحص الامتثال ليس تخليصاً ولا
-- إبلاغاً فعلياً؛ المستند لم يُبلَّغ لزاتكا قانونياً بعد. راجع resolveZatcaSubmissionKind في
-- src/lib/zatca/submission.ts — شركة على شهادة اختبار تُرسِل عبر /compliance/invoices فقط، لا
-- clearance/reporting (تأكَّد فعلياً من رفض 401 في الإنتاج عند استخدام شهادة اختبار مع مسار التخليص).
ALTER TYPE "ZatcaDocumentStatus" ADD VALUE IF NOT EXISTS 'compliance_checked';
