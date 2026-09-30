-- أثر حذف الأقسام على القيود المرحَّلة — للقراءة فقط، لكل مستأجر وشركة.
--
-- الخلفية: حتى #127 كان حذف قسم يُفرِّغ departmentId بصمت من كل سطر يحمله (ON DELETE SET NULL)، دون أي أثر لما كان.
-- لا يوجد سجل يثبت الحذف: لا تاريخ تعديل للسطر يتغيّر بـSET NULL، والحذف لم يكن يُسجَّل. فهذا الاستعلام **مؤشر** لا
-- إثبات: القسم اختياري في نموذج القيد، فقيد أُدخل أصلاً بقسم على بعض سطوره فقط يبدو مثل قيد حُذف قسم بعض سطوره.
--
-- ما يعدّه (قيود مرحَّلة فقط):
--   mixed_entries      — قيود بعض سطورها تحمل قسماً وبعضها لا (الشكل الذي يتركه حذف قسم كان على بعض السطور)
--   blank_lines_mixed  — عدد السطور بلا قسم في تلك القيود
--   blank_amount_mixed — مجموع مبالغ تلك السطور، مديناً أو دائناً (حجم ما قد يكون خرج من تقارير الأقسام)
--   lines_with_dept / lines_without_dept — كل السطور المرحَّلة للمقارنة (نسبة الاستخدام الطبيعية للأقسام في الشركة)
--   live_departments   — أقسام الشركة الموجودة الآن
-- قيد كل سطوره بلا قسم لا يُعَدّ هنا: لا يُميَّز من قيد أُدخل بلا أقسام أصلاً — هو الحد الذي لا يتجاوزه أي استعلام.
WITH line_flags AS (
  SELECT e."tenantId", e."companyId", e.id AS entry_id, (l.debit + l.credit) AS amount,
         (l."departmentId" IS NOT NULL) AS has_dept
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l."journalEntryId"
  WHERE e.status = 'posted'
),
entries AS (
  SELECT "tenantId", "companyId", entry_id,
         bool_or(has_dept) AS any_dept, bool_and(has_dept) AS all_dept,
         COUNT(*) FILTER (WHERE NOT has_dept) AS blank_lines,
         COALESCE(SUM(amount) FILTER (WHERE NOT has_dept), 0) AS blank_amount
  FROM line_flags GROUP BY "tenantId", "companyId", entry_id
)
SELECT t.name AS tenant, c.name AS company, c.id AS company_id,
       COUNT(*) FILTER (WHERE e.any_dept AND NOT e.all_dept)                       AS mixed_entries,
       COALESCE(SUM(e.blank_lines) FILTER (WHERE e.any_dept AND NOT e.all_dept), 0) AS blank_lines_mixed,
       COALESCE(SUM(e.blank_amount) FILTER (WHERE e.any_dept AND NOT e.all_dept), 0) AS blank_amount_mixed,
       (SELECT COUNT(*) FROM line_flags f WHERE f."companyId" = c.id AND f.has_dept)     AS lines_with_dept,
       (SELECT COUNT(*) FROM line_flags f WHERE f."companyId" = c.id AND NOT f.has_dept) AS lines_without_dept,
       (SELECT COUNT(*) FROM departments d WHERE d."companyId" = c.id OR (d."companyId" IS NULL AND d."tenantId" = t.id)) AS live_departments
FROM entries e
JOIN companies c ON c.id = e."companyId"
JOIN tenants t ON t.id = e."tenantId"
-- بمعرّف الشركة لا باسمها: الاسم فريد داخل المستأجر فقط
GROUP BY t.id, t.name, c.id, c.name
HAVING COUNT(*) FILTER (WHERE e.any_dept) > 0
ORDER BY mixed_entries DESC, t.name, c.name;
