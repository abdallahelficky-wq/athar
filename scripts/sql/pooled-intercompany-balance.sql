-- رصيد حساب "حساب جاري - شركات المجموعة" المجمَّع لكل شركة، موزَّعاً على الشركة المقابلة — للقراءة فقط.
-- الحساب المجمَّع = أول اسم موجود من سلسلة البدائل التي يستخدمها التحويل المخزني اليوم:
--   "حساب جاري - شركات المجموعة" ← "أطراف ذات علاقة مدينة" ← "عملاء - أطراف ذات علاقة"
-- تُعرَض كل الحسابات التي تحمل أحد الأسماء الثلاثة (حتى المؤرشفة/المعطّلة)، مع علامة used_today على
-- الحساب الذي يُرحَّل إليه التحويل فعلاً الآن.
-- الشركة المقابلة: من سطر التحويل الآخر بنفس transferGroupId في stock_movements. أي حركة من مصدر آخر
-- (قيد يدوي، سند...) تظهر "غير محددة" مع مصدرها — لا يمكن معرفة مقابلها من البيانات.
-- الرصيد = مدين − دائن للقيود المرحَّلة فقط. موجب = الشركة المقابلة مدينة لهذه الشركة.
WITH names(priority, name) AS (VALUES
  (0, 'حساب جاري - شركات المجموعة'), (1, 'أطراف ذات علاقة مدينة'), (2, 'عملاء - أطراف ذات علاقة')
),
pooled AS (
  SELECT a.id, a."companyId", a.code, a.name, n.priority,
         (a."isPosting" AND a."isActive" AND NOT a."isArchived") AS eligible
  FROM accounts a JOIN names n ON n.name = a.name
),
used AS (
  SELECT DISTINCT ON ("companyId") "companyId", id FROM pooled WHERE eligible ORDER BY "companyId", priority
),
lines AS (
  SELECT p."companyId", p.id AS account_id, e."sourceModule"::text AS source,
         other_co.name AS counterparty, l.debit, l.credit
  FROM pooled p
  JOIN journal_entry_lines l ON l."accountId" = p.id
  JOIN journal_entries e ON e.id = l."journalEntryId" AND e.status = 'posted'
  LEFT JOIN stock_movements m ON m."journalEntryId" = e.id AND m."transferGroupId" IS NOT NULL
  LEFT JOIN stock_movements m2 ON m2."transferGroupId" = m."transferGroupId" AND m2."companyId" <> m."companyId"
  LEFT JOIN companies other_co ON other_co.id = m2."companyId"
)
SELECT co.name AS company, co.id AS company_id,
       p.code || ' ' || p.name AS account,
       (u.id IS NOT NULL) AS used_today,
       CASE WHEN GROUPING(l.counterparty) = 1 THEN '== إجمالي الحساب =='
            ELSE COALESCE(l.counterparty, 'غير محددة (' || l.source || ')') END AS counterparty,
       ROUND(SUM(l.debit), 2) AS debit,
       ROUND(SUM(l.credit), 2) AS credit,
       ROUND(SUM(l.debit) - SUM(l.credit), 2) AS balance
FROM lines l
JOIN pooled p ON p.id = l.account_id
JOIN companies co ON co.id = l."companyId"
LEFT JOIN used u ON u.id = p.id
GROUP BY GROUPING SETS ((co.id, co.name, p.id, p.code, p.name, u.id, l.counterparty, l.source), (co.id, co.name, p.id, p.code, p.name, u.id))
ORDER BY co.name, account, GROUPING(l.counterparty), counterparty;
