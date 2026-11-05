-- تصنيف التحليل المالي للحسابات: متداول/غير متداول + دور الحساب في النسب المالية.
-- القيمة الفعلية لأي حساب = قيمته إن وُجدت، وإلا قيمة أقرب أب مصنَّف (src/lib/accountClassification.ts)،
-- لذلك يكفي غالباً تصنيف مجموعات المستوى الثاني والثالث. التعبئة أدناه مبنية على دليل صريح فقط:
--   1) اسم الحساب نفسه يقول "متداول/غير متداول/قصير/طويل الأجل" (عربي أو إنجليزي).
--   2) الحساب مربوط فعلاً في النظام: حساب مخزون مستودع أو صنف، حساب تكلفة مبيعات صنف، حساب عميل أو مورد.
--   3) اسم مجموعة يطابق حرفياً اسماً قياسياً (المخزون، العملاء، الموردون، تكلفة الإيرادات/المبيعات) أو يحوي
--      "إهلاك" لمصروف، أو "تمويل/فوائد" لمصروف أو تكلفة غير إيرادية.
-- ما لا يقع تحت أيٍّ منها يبقى فارغاً ويظهر في تقرير النسب كحساب غير مصنَّف — لا تخمين بالأكواد، لأن الشجرات
-- المُرحَّلة من أنظمة أخرى لا تتبع أكواد القالب. التعبئة لكل الشركات بمعرّفاتها؛ لا تجميع بالاسم عبر الشركات.

CREATE TYPE "AccountLiquidity" AS ENUM ('current', 'non_current');
CREATE TYPE "AccountAnalysisRole" AS ENUM ('receivables', 'payables', 'inventory', 'cost_of_sales', 'depreciation', 'finance_cost');

ALTER TABLE "accounts" ADD COLUMN "liquidity" "AccountLiquidity";
ALTER TABLE "accounts" ADD COLUMN "analysisRole" "AccountAnalysisRole";

-- التعبئة الأولية تصنيف نظامي لا تعديل مستخدم: لا تُسجَّل كـ"account.updated" بلا منفّذ في سجل التدقيق.
ALTER TABLE "accounts" DISABLE TRIGGER "accounts_record_change";

-- (1) السيولة من الاسم الصريح. الترتيب مقصود: "الجزء المتداول من قرض طويل الأجل" متداول (يُفحص أولاً)،
--     ثم "غير متداول/طويل الأجل/ثابتة" لأنها تحوي كلمة "متداول" أو تسبقها، ثم "متداول/قصير الأجل".
UPDATE "accounts" SET "liquidity" = 'current'
WHERE "type" IN ('asset', 'liability')
  AND ("name" ~ 'الجزء المتداول' OR COALESCE("nameEn", '') ~* 'current portion');

UPDATE "accounts" SET "liquidity" = 'non_current'
WHERE "liquidity" IS NULL AND "type" IN ('asset', 'liability')
  AND ("name" ~ '(غير ال?متداول|طويلة الأجل|طويل الأجل|طويلة الاجل|طويل الاجل)'
       OR COALESCE("nameEn", '') ~* '(non[- ]?current|long[- ]term)'
       OR ("type" = 'asset' AND ("name" ~ '^(ال)?(أصول|اصول|موجودات) (ال)?ثابتة' OR COALESCE("nameEn", '') ~* '^fixed assets')));

UPDATE "accounts" SET "liquidity" = 'current'
WHERE "liquidity" IS NULL AND "type" IN ('asset', 'liability')
  AND ("name" ~ '(متداول|قصيرة الأجل|قصير الأجل|قصيرة الاجل|قصير الاجل)'
       OR COALESCE("nameEn", '') ~* '(\mcurrent\M|short[- ]term)');

-- (2) روابط النظام الفعلية — حساب نفس الشركة فقط (الربط نفسه مقيَّد بالشركة).
UPDATE "accounts" a SET "analysisRole" = 'inventory'
WHERE a."type" = 'asset' AND (
  EXISTS (SELECT 1 FROM "warehouses" w WHERE w."stockAccountId" = a."id") OR
  EXISTS (SELECT 1 FROM "items" i WHERE i."stockAccountId" = a."id"));

UPDATE "accounts" a SET "analysisRole" = 'cost_of_sales'
WHERE a."analysisRole" IS NULL AND a."type" = 'expense'
  AND EXISTS (SELECT 1 FROM "items" i WHERE i."cogsAccountId" = a."id");

UPDATE "accounts" a SET "analysisRole" = 'receivables'
WHERE a."analysisRole" IS NULL AND a."type" = 'asset'
  AND EXISTS (SELECT 1 FROM "customers" c WHERE c."accountId" = a."id");

UPDATE "accounts" a SET "analysisRole" = 'payables'
WHERE a."analysisRole" IS NULL AND a."type" = 'liability'
  AND EXISTS (SELECT 1 FROM "suppliers" s WHERE s."accountId" = a."id");

-- (3) مجموعات بأسماء قياسية حرفية.
UPDATE "accounts" SET "analysisRole" = 'inventory'
WHERE "analysisRole" IS NULL AND "type" = 'asset' AND "isPosting" = false
  AND btrim("name") IN ('المخزون', 'مخزون', 'البضاعة', 'المخزون السلعي');

UPDATE "accounts" SET "analysisRole" = 'receivables'
WHERE "analysisRole" IS NULL AND "type" = 'asset' AND "isPosting" = false
  AND btrim("name") IN ('عملاء', 'العملاء', 'الذمم المدينة', 'الذمم المدينة التجارية', 'الذمم المدينة القياسية', 'ذمم مدينة تجارية');

UPDATE "accounts" SET "analysisRole" = 'payables'
WHERE "analysisRole" IS NULL AND "type" = 'liability' AND "isPosting" = false
  AND btrim("name") IN ('موردون', 'الموردون', 'موردين', 'الموردين', 'الذمم الدائنة', 'الذمم الدائنة التجارية', 'الذمم الدائنة القياسية');

UPDATE "accounts" SET "analysisRole" = 'cost_of_sales'
WHERE "analysisRole" IS NULL AND "type" = 'expense' AND "isPosting" = false
  AND btrim("name") IN ('تكلفة الإيرادات', 'تكلفة الايرادات', 'تكلفة المبيعات', 'تكلفة البضاعة المباعة', 'تكاليف المبيعات');

UPDATE "accounts" SET "analysisRole" = 'depreciation'
WHERE "analysisRole" IS NULL AND "type" = 'expense' AND "name" ~ '(إهلاك|اهلاك|استهلاك الأصول)';

UPDATE "accounts" SET "analysisRole" = 'finance_cost'
WHERE "analysisRole" IS NULL AND "type" IN ('expense', 'revenue')
  AND "name" ~ '(تمويل|فوائد)' AND "name" !~ '(إيراد|ايراد)';

ALTER TABLE "accounts" ENABLE TRIGGER "accounts_record_change";

-- سجل التدقيق يتتبّع الحقلين من الآن: تعديل المستخدم لهما يُسجَّل بقيمته قبل/بعد ومن نفّذه.
CREATE OR REPLACE FUNCTION account_record_change() RETURNS trigger AS $$
DECLARE
  changes JSONB := '{}'::jsonb;
  actor TEXT := NULLIF(current_setting('app.actor_user_id', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "audit_logs" ("id", "tenantId", "companyId", "userId", "action", "entityType", "entityId", "metadata")
    VALUES ('acd_' || gen_random_uuid()::text, OLD."tenantId", OLD."companyId", actor, 'account.deleted', 'Account', OLD."id",
            jsonb_build_object('provenance', 'recorded', 'before', jsonb_build_object(
              'code', OLD."code", 'name', OLD."name", 'nameEn', OLD."nameEn", 'type', OLD."type"::text, 'parentId', OLD."parentId",
              'isBankOrCash', OLD."isBankOrCash", 'isArchived', OLD."isArchived", 'isActive', OLD."isActive",
              'isPosting', OLD."isPosting", 'isPersonalGroup', OLD."isPersonalGroup",
              'liquidity', OLD."liquidity"::text, 'analysisRole', OLD."analysisRole"::text)));
    RETURN OLD;
  END IF;

  IF NEW."code" IS DISTINCT FROM OLD."code" THEN changes := changes || jsonb_build_object('code', jsonb_build_object('from', OLD."code", 'to', NEW."code")); END IF;
  IF NEW."name" IS DISTINCT FROM OLD."name" THEN changes := changes || jsonb_build_object('name', jsonb_build_object('from', OLD."name", 'to', NEW."name")); END IF;
  IF NEW."nameEn" IS DISTINCT FROM OLD."nameEn" THEN changes := changes || jsonb_build_object('nameEn', jsonb_build_object('from', OLD."nameEn", 'to', NEW."nameEn")); END IF;
  IF NEW."type" IS DISTINCT FROM OLD."type" THEN changes := changes || jsonb_build_object('type', jsonb_build_object('from', OLD."type"::text, 'to', NEW."type"::text)); END IF;
  IF NEW."parentId" IS DISTINCT FROM OLD."parentId" THEN changes := changes || jsonb_build_object('parentId', jsonb_build_object('from', OLD."parentId", 'to', NEW."parentId")); END IF;
  IF NEW."isBankOrCash" IS DISTINCT FROM OLD."isBankOrCash" THEN changes := changes || jsonb_build_object('isBankOrCash', jsonb_build_object('from', OLD."isBankOrCash", 'to', NEW."isBankOrCash")); END IF;
  IF NEW."isArchived" IS DISTINCT FROM OLD."isArchived" THEN changes := changes || jsonb_build_object('isArchived', jsonb_build_object('from', OLD."isArchived", 'to', NEW."isArchived")); END IF;
  IF NEW."isActive" IS DISTINCT FROM OLD."isActive" THEN changes := changes || jsonb_build_object('isActive', jsonb_build_object('from', OLD."isActive", 'to', NEW."isActive")); END IF;
  IF NEW."isPosting" IS DISTINCT FROM OLD."isPosting" THEN changes := changes || jsonb_build_object('isPosting', jsonb_build_object('from', OLD."isPosting", 'to', NEW."isPosting")); END IF;
  IF NEW."isPersonalGroup" IS DISTINCT FROM OLD."isPersonalGroup" THEN changes := changes || jsonb_build_object('isPersonalGroup', jsonb_build_object('from', OLD."isPersonalGroup", 'to', NEW."isPersonalGroup")); END IF;
  IF NEW."liquidity" IS DISTINCT FROM OLD."liquidity" THEN changes := changes || jsonb_build_object('liquidity', jsonb_build_object('from', OLD."liquidity"::text, 'to', NEW."liquidity"::text)); END IF;
  IF NEW."analysisRole" IS DISTINCT FROM OLD."analysisRole" THEN changes := changes || jsonb_build_object('analysisRole', jsonb_build_object('from', OLD."analysisRole"::text, 'to', NEW."analysisRole"::text)); END IF;

  IF changes <> '{}'::jsonb THEN
    INSERT INTO "audit_logs" ("id", "tenantId", "companyId", "userId", "action", "entityType", "entityId", "metadata")
    VALUES ('acu_' || gen_random_uuid()::text, NEW."tenantId", NEW."companyId", actor,
            CASE WHEN changes ? 'parentId' THEN 'account.moved' ELSE 'account.updated' END, 'Account', NEW."id",
            jsonb_build_object('provenance', 'recorded', 'changes', changes));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
