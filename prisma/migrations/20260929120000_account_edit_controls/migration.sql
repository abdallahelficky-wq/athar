-- ضوابط تعديل شجرة الحسابات والأقسام — في قاعدة البيانات نفسها لا في مسار واحد من الكود، لأن الحسابات تُعدَّل من
-- أكثر من عشرة مواضع (شاشة الحسابات، تسمية العميل/المورد/الموظف التي تعيد تسمية حسابه، الأصناف، المرآة…).

-- 1) حذف قسم مستخدَم في سطر قيد: كان ON DELETE SET NULL — الحذف يمسح القسم بصمت من قيود مرحَّلة ويغيّر
--    تاريخ الدفاتر. الآن يُرفَض ما دام أي سطر يشير إليه (الخادم يعطي رسالة واضحة قبل ذلك).
ALTER TABLE "journal_entry_lines" DROP CONSTRAINT "journal_entry_lines_departmentId_fkey";
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) نوع الحساب لا يتغيّر بعد وجود قيود عليه أو على أي حساب تحته: النوع يحدّد موضعه في القوائم المالية، وتغييره
--    يعيد تصنيف أرصدة فترات مُقفَلة ومقدَّمة بصمت. القيود المحفوظة (غير المرحَّلة) تُحسَب أيضاً — ستُرحَّل يوماً.
CREATE OR REPLACE FUNCTION account_type_locked() RETURNS trigger AS $$
BEGIN
  IF NEW."type" IS DISTINCT FROM OLD."type" AND EXISTS (
    WITH RECURSIVE tree AS (
      SELECT OLD."id" AS id
      UNION ALL
      SELECT a."id" FROM "accounts" a JOIN tree t ON a."parentId" = t.id
    )
    SELECT 1 FROM "journal_entry_lines" l JOIN tree t ON l."accountId" = t.id LIMIT 1
  ) THEN
    RAISE EXCEPTION 'account_type_locked: account % has journal entries; its type cannot change', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_type_locked BEFORE UPDATE OF "type" ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION account_type_locked();

-- 3) كل تعديل على حساب يُسجَّل في audit_logs: الحقول المتتبَّعة وقيمتها قبل وبعد، ومن نفّذه. المنفّذ من إعداد
--    المعاملة app.actor_user_id (setAuditActor في src/lib/auditActor.ts)؛ بدونه يبقى فارغاً — «غير مسجَّل» — لا يُنسَب
--    لأحد خطأً. audit_fill_actor (#111) يحفظ نسخة اسمه وبريده. النقل (تغيير الأب) مسموح ويُسجَّل كغيره.
--    provenance = "recorded" بنفس معنى سجل التاريخ (#126).
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
              'isPosting', OLD."isPosting", 'isPersonalGroup', OLD."isPersonalGroup")));
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

  IF changes <> '{}'::jsonb THEN
    INSERT INTO "audit_logs" ("id", "tenantId", "companyId", "userId", "action", "entityType", "entityId", "metadata")
    VALUES ('acu_' || gen_random_uuid()::text, NEW."tenantId", NEW."companyId", actor,
            CASE WHEN changes ? 'parentId' THEN 'account.moved' ELSE 'account.updated' END, 'Account', NEW."id",
            jsonb_build_object('provenance', 'recorded', 'changes', changes));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_record_change AFTER UPDATE OR DELETE ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION account_record_change();
