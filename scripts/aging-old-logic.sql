-- أعمار الذمم بالمنطق القديم (قبل #119) — كما كان يعرضها التقرير الشهري الشامل، لنهاية كل شهر محدَّد.
-- للقراءة فقط. يُشغَّل على Neon كما هو. المنطق القديم بالضبط (reports.service.ts قبل #119):
--   المدينة: كل فاتورة مبيعات مرحّلة حتى نهاية الشهر، ناقص كل تخصيصاتها الحالية (بلا اعتبار لتاريخ التخصيص)، لا تقل عن صفر.
--   الدائنة: إجمالي كل فاتورة مشتريات مرحّلة حتى نهاية الشهر — بلا طرح أي سداد إطلاقاً.
--   العمر: أيام صحيحة من تاريخ الفاتورة إلى آخر ملّي ثانية في الشهر (UTC)؛ ≤30، ≤60، ≤90، وما فوق.
-- ملاحظة: التخصيصات "الحالية" تعني وقت تشغيل الاستعلام — شغّله قبل أي تخصيص جديد حتى يطابق ما كان على الشاشة.
WITH target_companies AS (
  SELECT id, name FROM companies
  WHERE name ILIKE '%تيسم%' OR name ILIKE '%ارمي%' OR name ILIKE '%أرمي%'
),
month_ends AS (
  SELECT (d + INTERVAL '1 month' - INTERVAL '1 millisecond')::timestamp AS to_ts
  FROM (VALUES (DATE '2026-06-01'), (DATE '2026-07-01'), (DATE '2026-08-01')) v(d)
),
docs AS (
  SELECT c.name AS company, m.to_ts, 'receivables' AS side, i.date,
         GREATEST(i."grandTotal" - COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a WHERE a."invoiceId" = i.id), 0), 0) AS due
  FROM target_companies c CROSS JOIN month_ends m
  JOIN sales_invoices i ON i."companyId" = c.id AND i.status = 'posted' AND i.date <= m.to_ts
  UNION ALL
  SELECT c.name, m.to_ts, 'payables', p.date, p."grandTotal"
  FROM target_companies c CROSS JOIN month_ends m
  JOIN purchase_invoices p ON p."companyId" = c.id AND p.status = 'posted' AND p.date <= m.to_ts
),
aged AS (
  SELECT *, FLOOR(EXTRACT(EPOCH FROM (to_ts - date)) / 86400) AS days FROM docs
)
SELECT company, to_ts::date AS month_end, side,
       ROUND(SUM(due) FILTER (WHERE days <= 30), 2)                 AS under30,
       ROUND(SUM(due) FILTER (WHERE days > 30 AND days <= 60), 2)   AS d30to60,
       ROUND(SUM(due) FILTER (WHERE days > 60 AND days <= 90), 2)   AS d60to90,
       ROUND(SUM(due) FILTER (WHERE days > 90), 2)                  AS over90,
       ROUND(SUM(due), 2)                                           AS total
FROM aged
GROUP BY company, to_ts, side
ORDER BY company, month_end, side;
