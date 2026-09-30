-- سجل تاريخ السجلات، القطعة الأولى: من أنشأ القيد ومتى — صف "journal_entry.created" في audit_logs لكل قيد.
--
-- لماذا في audit_logs لا حقل جديد على القيد: هو نفس السجل الذي سيحمل كل تغيير لاحق (تعديل، ترحيل، فك ترحيل — الأخير
-- مسجَّل هكذا أصلاً)، ومُشغِّل audit_fill_actor (#111) يحفظ فيه نسخة من اسم المنفّذ وبريده لحظة الكتابة، فلا يضيع الاسم
-- إن عُدِّل المستخدم أو عُطِّل. آلية واحدة للمنشئ ولسجل التاريخ، لا آليتان.
--
-- لماذا مُشغِّل في قاعدة البيانات لا في كود الإنشاء: القيود تُنشأ من ستة مسارات على الأقل (اليدوي، الوحدات عبر
-- createJournalEntryTx، المرآة، العكس، النسخ، الاستيراد الجماعي بـcreateMany). المُشغِّل يغطّيها كلها وأي مسار مستقبلي.
--
-- metadata.provenance يفرّق بين ادّعاءين مختلفين أمام المدقق:
--   "recorded"   — كُتب لحظة إنشاء القيد نفسها (هذا المُشغِّل)؛
--   "backfilled" — أُعيد بناؤه لاحقاً من journal_entries.createdBy/createdAt (الاستكمال أدناه)، والاسم هو اسم المستخدم
--                  كما هو وقت الاستكمال لا بالضرورة وقت الإنشاء. شاشة سجل التاريخ يجب أن تُظهر هذا الفرق.
-- المعرّف 'jec_' || معرّف القيد: صف إنشاء واحد لكل قيد، والاستكمال لا يُكرِّره (ON CONFLICT).

CREATE OR REPLACE FUNCTION journal_entry_record_created() RETURNS trigger AS $$
BEGIN
  INSERT INTO "audit_logs" ("id", "tenantId", "companyId", "userId", "action", "entityType", "entityId", "metadata", "createdAt")
  VALUES ('jec_' || NEW."id", NEW."tenantId", NEW."companyId", NEW."createdBy", 'journal_entry.created', 'JournalEntry', NEW."id",
          jsonb_build_object('provenance', 'recorded', 'sourceModule', NEW."sourceModule"::text), NEW."createdAt")
  ON CONFLICT ("id") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_record_created AFTER INSERT ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_entry_record_created();

-- الاستكمال الرجعي للقيود الموجودة. audit_fill_actor يملأ الاسم والبريد لمن وُجد له مستخدم؛ createdBy الفارغ أو
-- المشير إلى مستخدم غير موجود يبقى بلا اسم — يُعرَض «غير مسجَّل».
INSERT INTO "audit_logs" ("id", "tenantId", "companyId", "userId", "action", "entityType", "entityId", "metadata", "createdAt")
SELECT 'jec_' || e."id", e."tenantId", e."companyId", e."createdBy", 'journal_entry.created', 'JournalEntry', e."id",
       jsonb_build_object('provenance', 'backfilled', 'sourceModule', e."sourceModule"::text), e."createdAt"
FROM "journal_entries" e
ON CONFLICT ("id") DO NOTHING;
