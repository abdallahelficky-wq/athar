-- CHECK 2 (مراجعة PR #76): إشعارات المدين تحوّلت في هذا الإصلاح من formatDocNumber("DBN", count)
-- (عدّاد واحد لكل المستأجر بالكامل) إلى reserveDocumentNumber (عدّاد ذرّي منفصل لكل شركة على حدة
-- في document_numbering_settings، تماماً كـSalesInvoice/SalesReturn) — بلا تعديل مرافق للقيد
-- الفريد القديم (tenantId, debitNoteNumber) ليطابق نطاق العدّاد الجديد، ولا لأي عدّاد يبدأ من الرقم
-- الأعلى الموجود فعلاً بدل الصفر. هذا يُنتج تصادمين مضمونين لأي مستأجر لديه بيانات فعلية:
--   1. شركتان مختلفتان بنفس المستأجر: كلتاهما تبدآن العدّ من 1 في document_numbering_settings
--      (نطاقه لكل شركة) لكن يُقارَنان بقيد فريد واحد يشمل المستأجر كله — أول إشعار مدين جديد لكل
--      منهما بعد هذا الإصلاح يحمل "DBN-00001"، فيفشل الثاني بانتهاك القيد الفريد فوراً.
--   2. أي شركة لديها إشعارات مدين موجودة فعلاً قبل هذا الإصلاح: العدّاد الجديد يبدأ من 1 بصرف
--      النظر عن ذلك، فيُصادم أول رقم قديم موجود بالفعل ("DBN-00001" مكرراً).

-- 1) توسيع القيد الفريد ليطابق نطاق العدّاد الجديد (لكل شركة، لا للمستأجر بالكامل) — قيد أضعف من
-- القديم (كل ما يحقق القديم يحقق الجديد تلقائياً)، فلا خطر تعارض مع أي بيانات موجودة عند التطبيق.
DROP INDEX "sales_debit_notes_tenantId_debitNoteNumber_key";
CREATE UNIQUE INDEX "sales_debit_notes_tenantId_companyId_debitNoteNumber_key" ON "sales_debit_notes"("tenantId", "companyId", "debitNoteNumber");

-- 2) تهيئة مسبقة لعدّاد كل شركة لديها إشعارات مدين موجودة فعلاً بالفعل، بحيث يبدأ أول رقم جديد بعد
-- هذا الإصلاح أكبر بمقدار 1 فقط من أعلى رقم موجود لها — لا من 1. صيغة الرقم القديمة ثابتة دائماً
-- "DBN-NNNNN" (formatDocNumber لا تدعم أي تخصيص)، فاستخراج الجزء الرقمي بإزالة كل ما هو غير رقم
-- كافٍ ومضمون هنا. reserveDocumentNumber's upsert (update: {}) لا يكتب فوق صف موجود بالفعل، فهذه
-- التهيئة تسبق أي استدعاء تطبيقي لاحق وتُحترَم بالكامل. الشركات التي لا تملك إشعارات مدين بعد
-- تستمر بالسلوك الافتراضي القديم تماماً (أول استدعاء يُنشئ الصف بـnextSeq=1 كما كان).
INSERT INTO "document_numbering_settings" ("id", "tenantId", "companyId", "docType", "prefix", "digits", "resetMode", "nextSeq", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  sdn."tenantId",
  sdn."companyId",
  'sales_debit_note',
  'DBN-',
  5,
  'continuous',
  MAX(NULLIF(regexp_replace(sdn."debitNoteNumber", '\D', '', 'g'), '')::integer) + 1,
  now(),
  now()
FROM "sales_debit_notes" sdn
WHERE regexp_replace(sdn."debitNoteNumber", '\D', '', 'g') <> ''
GROUP BY sdn."tenantId", sdn."companyId";
