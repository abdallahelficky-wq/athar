-- نسخة صف الاشتراك للتزامن المتفائل في لوحة المدير (P9): المدير يرسل النسخة التي حمّلها، ونسخة قديمة تُرفض بـ409.
-- المشغّل يزيدها عند كل UPDATE من أي كاتب (لوحة المدير، المُجدوِل، التعليق والتفعيل، أي استعلام مباشر) — لا يعتمد على تذكّر كل مسار.
ALTER TABLE "company_subscriptions" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION company_subscriptions_bump_version() RETURNS trigger AS $$
BEGIN
  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER company_subscriptions_version
  BEFORE UPDATE ON "company_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION company_subscriptions_bump_version();
