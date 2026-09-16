-- حالة زاتكا جديدة منفصلة تماماً عن submission_failed: فشل توقيع محلي بسبب شهادة/مفتاح غير
-- صالح (لا عطل شبكة، لا رد رفض من زاتكا) — لا تُصلَح نفسها بإعادة المحاولة، فتُستبعَد عمداً من
-- إعادة المحاولة التلقائية (راجع ZATCA_AUTO_RETRY_STATUSES في salesInvoices.service.ts) حتى لا
-- تُستهلَك فتحات الدفعة الدورية إلى ما لا نهاية على مستند لن ينجح أبداً بلا تدخل بشري.
ALTER TYPE "ZatcaDocumentStatus" ADD VALUE IF NOT EXISTS 'certificate_error';
