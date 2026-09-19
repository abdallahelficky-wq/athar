-- يسجّل نوع الفاتورة المُعلَن فعلياً في حقل title بقسم v3_req من CSR الحالي لكل شركة — عطل حقيقي
-- مؤكَّد: كان القالب (csrConfigTemplate.ts) يفرض 0100 (مبسّط فقط) دائماً بصرف النظر عن احتياج
-- الشركة الفعلي، فشركات تُصدر فواتير قياسية B2B فعلياً كانت تحصل على شهادة لا تُخوِّل ذلك. يحتاجه
-- منطق التلقيم الآلي المستقبلي لمعرفة عدد/نوع مستندات الامتثال الستة التي تتطلبها زاتكا فعلياً، لا
-- افتراض الستة كاملة دائماً.
CREATE TYPE "ZatcaCsrInvoiceType" AS ENUM ('standard', 'simplified', 'both');

ALTER TABLE "company_zatca_credentials" ADD COLUMN "csrInvoiceType" "ZatcaCsrInvoiceType";
