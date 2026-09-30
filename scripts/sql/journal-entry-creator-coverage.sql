-- «أعدّه» للقيود الموجودة: كم منها سيُعرَف منشئه بعد الاستكمال الرجعي وكم سيُعرَض «غير مسجَّل» — لكل شركة. للقراءة فقط.
-- يُشغَّل قبل ترحيل 20260929100000_journal_entry_created_audit أو بعده (لا يعتمد عليه).
--   known       — createdBy يشير إلى مستخدم موجود: يُستكمَل باسمه الحالي (مُعلَّماً backfilled)
--   no_creator  — createdBy فارغ (قيود النظام، استيراد قديم، أو ما قبل حفظ المنشئ)
--   ghost       — createdBy يشير إلى مستخدم غير موجود
SELECT t.name AS tenant, c.name AS company, c.id AS company_id,
       COUNT(*)                                                        AS entries,
       COUNT(*) FILTER (WHERE u.id IS NOT NULL)                        AS known,
       COUNT(*) FILTER (WHERE e."createdBy" IS NULL)                   AS no_creator,
       COUNT(*) FILTER (WHERE e."createdBy" IS NOT NULL AND u.id IS NULL) AS ghost,
       MIN(e."createdAt") FILTER (WHERE e."createdBy" IS NULL)         AS earliest_no_creator,
       MAX(e."createdAt") FILTER (WHERE e."createdBy" IS NULL)         AS latest_no_creator
FROM journal_entries e
JOIN companies c ON c.id = e."companyId"
JOIN tenants t ON t.id = c."tenantId"
LEFT JOIN users u ON u.id = e."createdBy"
-- التجميع بمعرّف الشركة لا باسمها: الاسم فريد داخل المستأجر فقط، وشركتان بنفس الاسم في مستأجرين مختلفين تُدمَجان خطأً
GROUP BY t.name, c.id, c.name
ORDER BY t.name, c.name;

-- مصدر القيود بلا منشئ (أي الوحدات تكتب قيوداً بلا createdBy):
-- SELECT "sourceModule", COUNT(*) FROM journal_entries WHERE "createdBy" IS NULL GROUP BY 1 ORDER BY 2 DESC;
