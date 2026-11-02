-- أرصدة حسابات الوقود الحالية — للقراءة فقط (SELECT وحده).
--
-- الحسابات: 114001 مخزون بنزين، 114002 مخزون ديزل، 511001 تكلفة شراء الوقود، 511004 فاقد قياس الخزانات،
-- وحسابات إيراد الوقود: 411001/411002/411003 أو أي حساب اسمه "إيراد مبيعات بنزين 91|95|ديزل" (يُبحث عنها بالاسم في
-- resolveShiftClosingAccounts — stationShifts.service.ts — فقد تختلف رموزها بين الشجرات).
-- صف لكل (شركة، حساب): posted_debit / posted_credit / posted_balance (مدين − دائن، القيود المرحَّلة فقط — كما تحتسبها
-- التقارير)، وsaved_debit / saved_credit (قيود محفوظة غير مرحَّلة، للعلم فقط)، وlines.
-- الحدود: الرصيد منذ أول قيد (بلا فترة) — بما فيه أي قيد افتتاحي. الرمز يُطابَق داخل شركته: account_name يكشف شجرة
-- تستخدم الرمز نفسه لحساب آخر. شركة بلا أي من هذه الحسابات تظهر بصف واحد فارغ. يُجمَّع بمعرّف الحساب والشركة.
WITH accts AS (
  SELECT a.id, a."companyId", a.code, a.name, a.type::text AS type
  FROM accounts a
  WHERE a.code IN ('114001', '114002', '511001', '511004', '411001', '411002', '411003')
     OR a.name IN ('إيراد مبيعات بنزين 91', 'إيراد مبيعات بنزين 95', 'إيراد مبيعات ديزل')
),
agg AS (
  SELECT l."accountId",
         COALESCE(SUM(l.debit)  FILTER (WHERE e.status = 'posted'), 0) AS posted_debit,
         COALESCE(SUM(l.credit) FILTER (WHERE e.status = 'posted'), 0) AS posted_credit,
         COALESCE(SUM(l.debit)  FILTER (WHERE e.status = 'saved'), 0)  AS saved_debit,
         COALESCE(SUM(l.credit) FILTER (WHERE e.status = 'saved'), 0)  AS saved_credit,
         COUNT(*) AS lines
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l."journalEntryId"
  WHERE l."accountId" IN (SELECT id FROM accts)
  GROUP BY l."accountId"
)
SELECT t.id AS tenant_id, t.name AS tenant, c.id AS company_id, c.name AS company,
       a.code AS account_code, a.name AS account_name, a.type AS account_type,
       COALESCE(agg.posted_debit, 0) AS posted_debit, COALESCE(agg.posted_credit, 0) AS posted_credit,
       COALESCE(agg.posted_debit, 0) - COALESCE(agg.posted_credit, 0) AS posted_balance,
       COALESCE(agg.saved_debit, 0) AS saved_debit, COALESCE(agg.saved_credit, 0) AS saved_credit,
       COALESCE(agg.lines, 0) AS lines
FROM companies c
JOIN tenants t ON t.id = c."tenantId"
LEFT JOIN accts a ON a."companyId" = c.id
LEFT JOIN agg ON agg."accountId" = a.id
ORDER BY t.name, c.name, c.id, a.code
