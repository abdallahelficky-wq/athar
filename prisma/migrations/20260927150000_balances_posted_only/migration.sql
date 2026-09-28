-- الأرصدة تحتسب القيود المرحَّلة فقط، بمفتاح لكل شركة. الشركات الجديدة وكل شركة ليس فيها أي قيد محفوظ
-- تبدأ مفعَّلة (true) — لا فرق في أرقامها. الشركات التي فيها قيود محفوظة الآن تبدأ false (تبقى أرقامها كما
-- هي، المحفوظ يُحتسَب) إلى أن يراجع المالك تلك القيود ويفعّل المفتاح، حتى لا تتغيّر أرصدتها المعلَنة
-- فجأة بمجرد النشر.
ALTER TABLE "companies" ADD COLUMN "balancesPostedOnly" BOOLEAN NOT NULL DEFAULT true;

UPDATE "companies" c SET "balancesPostedOnly" = false
WHERE EXISTS (SELECT 1 FROM "journal_entries" je WHERE je."companyId" = c.id AND je.status = 'saved');
