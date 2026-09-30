-- حجم تصدير أرشيف زاتكا لكل شركة ولكل شهر — آخر 12 شهراً مكتملاً + الشهر الجاري. للقراءة فقط.
-- المستند المعدود = ما يدخل تصدير الشهر: كل فاتورة/إشعار دائن/إشعار مدين قبلته زاتكا (cleared أو reported) وتاريخ
-- إرساله في الشهر — بنفس حدود التصدير (أيام UTC على zatcaSubmittedAt). الحد الحالي 65,534 للتصدير الواحد؛ عتبة
-- البناء المتّفق عليها 50,000 لشهر واحد لأي شركة. company_12m_total = حجم تصدير سنوي واحد لتلك الشركة.
-- archived = منها ما له أصل محفوظ في الأرشيف (الباقي يظهر "missing" في manifest ولا يُعدّ ملفاً داخل ZIP).
WITH docs AS (
  SELECT 'sales_invoice' AS kind, id, "companyId", "zatcaSubmittedAt" AS at, "invoiceType"::text AS subtype FROM sales_invoices WHERE "zatcaStatus" IN ('cleared','reported')
  UNION ALL SELECT 'sales_return', id, "companyId", "zatcaSubmittedAt", CASE WHEN "zatcaStatus" = 'cleared' THEN 'standard' ELSE 'simplified' END FROM sales_returns WHERE "zatcaStatus" IN ('cleared','reported')
  UNION ALL SELECT 'sales_debit_note', id, "companyId", "zatcaSubmittedAt", CASE WHEN "zatcaStatus" = 'cleared' THEN 'standard' ELSE 'simplified' END FROM sales_debit_notes WHERE "zatcaStatus" IN ('cleared','reported')
),
windowed AS (
  SELECT d.*, date_trunc('month', d.at)::date AS month,
         EXISTS (SELECT 1 FROM zatca_document_archive a WHERE a."documentType" = d.kind AND a."documentId" = d.id) AS archived
  FROM docs d
  WHERE d.at >= date_trunc('month', now() AT TIME ZONE 'UTC') - INTERVAL '12 months'
)
SELECT t.name AS tenant, c.name AS company, c.id AS company_id, to_char(w.month, 'YYYY-MM') AS month,
       COUNT(*)                                        AS documents_in_export,
       COUNT(*) FILTER (WHERE w.subtype = 'simplified') AS simplified,
       COUNT(*) FILTER (WHERE w.subtype = 'standard')   AS standard,
       COUNT(*) FILTER (WHERE w.archived)               AS archived,
       ROUND(100.0 * COUNT(*) / 65534, 2)               AS pct_of_zip_cap,
       SUM(COUNT(*)) OVER (PARTITION BY c.id)         AS company_12m_total,
       CASE WHEN COUNT(*) > 50000 THEN 'TRIGGER: monthly > 50,000'
            WHEN SUM(COUNT(*)) OVER (PARTITION BY c.id) > 65534 THEN 'yearly export exceeds cap'
            ELSE '' END AS flag
FROM windowed w JOIN companies c ON c.id = w."companyId" JOIN tenants t ON t.id = c."tenantId"
-- بمعرّف الشركة لا باسمها: الاسم فريد داخل المستأجر فقط
GROUP BY t.name, c.id, c.name, w.month
ORDER BY t.name, c.name, w.month;

