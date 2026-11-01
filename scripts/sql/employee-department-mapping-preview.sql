-- معاينة ربط قسم الموظف النصّي القديم (employees.department) بسجلات الأقسام (departments) — للقراءة فقط، لا يغيّر شيئاً.
-- يُستخدَم قبل تعبئة Employee.departmentId الجديد (تحميل تكلفة الرواتب، قرار المالك 2026-11-01). التعبئة نفسها تتم
-- من شاشة الموظف أو بقرار منفصل — هذا الاستعلام لا يكتب.
--
-- لكل (مستأجر، شركة، نص قسم مكتوب) يعدّ:
--   employees          — موظفو هذه الشركة بهذا النص (بعد قصّ المسافات، بلا اعتبار لحالة الأحرف)
--   already_linked     — منهم من له departmentId بالفعل
--   candidate_count    — أقسام مطابقة الاسم في المستأجر نفسه، من الشركة نفسها أو بلا شركة (عامة للمستأجر)
--   candidate_ids      — معرّفاتها؛ 0 = لا قسم مطابق (يُنشأ أو يُختار يدوياً)، أكثر من 1 = غامض (يُختار يدوياً)
--   suggested_department_id — المعرّف حين يوجد مطابق واحد فقط
-- الربط والتجميع بالمعرّفات (tenantId، companyId) لا بالأسماء: اسم الشركة فريد داخل المستأجر فقط، واسم القسم قد يتكرر
-- بين المستأجرين. اسم الشركة يُعرَض فقط للقراءة.
-- حدوده: مطابقة الاسم حرفياً بعد القصّ وتوحيد حالة الأحرف — لا يوحّد الهمزات ولا «ال» التعريف ولا الأخطاء الإملائية.
-- موظفون بلا نص قسم (NULL أو فارغ) يظهرون في صف واحد لكل شركة بـ department_text = NULL. شركة بلا موظفين تظهر بصف
-- واحد employees = 0 (لا شيء يُربَط) — فكل شركة ظاهرة بمعرّفها.
WITH emp AS (
  SELECT e."tenantId", e."companyId", NULLIF(btrim(e.department), '') AS department_text, e."departmentId"
  FROM employees e
),
grouped AS (
  SELECT "tenantId", "companyId", department_text,
         COUNT(*) AS employees,
         COUNT("departmentId") AS already_linked
  FROM emp
  GROUP BY "tenantId", "companyId", department_text
)
SELECT c."tenantId" AS tenant_id, c.id AS company_id, c.name AS company_name,
       g.department_text, COALESCE(g.employees, 0) AS employees, COALESCE(g.already_linked, 0) AS already_linked,
       COUNT(d.id) AS candidate_count,
       COALESCE(string_agg(d.id, ', ' ORDER BY d.id), '') AS candidate_ids,
       CASE WHEN COUNT(d.id) = 1 THEN MIN(d.id) END AS suggested_department_id
FROM companies c
LEFT JOIN grouped g ON g."companyId" = c.id AND g."tenantId" = c."tenantId"
LEFT JOIN departments d
  ON g.department_text IS NOT NULL
 AND d."tenantId" = g."tenantId"
 AND (d."companyId" = g."companyId" OR d."companyId" IS NULL)
 AND lower(btrim(d.name)) = lower(g.department_text)
GROUP BY c."tenantId", c.id, c.name, g.department_text, g.employees, g.already_linked
ORDER BY c."tenantId", c.name, c.id, g.department_text NULLS LAST;
