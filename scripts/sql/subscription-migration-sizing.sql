-- حجم ترحيل الاشتراكات إلى "اشتراك لكل شركة" — صف لكل شركة. للقراءة فقط (SELECT وحده، لا كتابة). راجع
-- docs/design/subscription-plans.md (قسم الترحيل). يُشغِّله المالك يدوياً؛ لم يُشغَّل على الإنتاج.
--
-- ما يعدّه:
--   * owner_identity_id/owner_email: هوية مالك المستأجر (tenants.ownerId ← users.identityId) — نطاق الخصم المعتمد هو هوية المالك.
--     مستأجر بلا ownerId يظهر بمالك فارغ (owner_identity_id NULL) ويحتاج قراراً يدوياً.
--   * owner_rank: ترتيب الشركة بين كل شركات نفس هوية المالك عبر كل مستأجراته، بتاريخ الإنشاء (ثم المعرّف لكسر التعادل) —
--     1 = السعر الكامل، 2 = خصم 20%... (قاعدة التصميم). owner_company_count = عدد شركات تلك الهوية.
--   * حالة الاشتراك الحالية منسوخة من المستأجر (كل شركات المستأجر الواحد تتشاركها اليوم).
--   * active_users: عضويات فعّالة مقبولة غير محذوفة نطاقها "all" أو هذه الشركة — الرقم الذي يُقارَن بحد الباقة لكل شركة.
--     عضوية "all" تُعدّ في كل شركات مستأجرها (هكذا ستُعدّ تحت الإنفاذ لكل شركة).
--   * pos_capable_users: منها من منصبه يمنح pos.create — قائمة مرشّحين فقط: مستخدم نقطة البيع في التصميم هو من يُعيَّن صراحةً
--     لكل شركة (لا أحد معيَّن قبل الترحيل)، والمالك وsuper_admin لا يُعدّان إلا إن عُيِّنا.
--   * إشارات الاستخدام لاقتراح باقة: warehouses (>1 = احترافية)، stock_transfers/issues، fixed_assets، employees، المحطات/الإسطبلات بالنشاط.
-- حدوده: لا يقرأ فواتير لوحة المدير (قاعدة بيانات منفصلة) — تُطابَق معه بـtenant_id. لا يعرف السعر الحالي المتّفق عليه مع
-- العملاء الخارجيين (غير مخزَّن في أثر).
WITH owners AS (
  SELECT t.id AS tenant_id, u."identityId" AS owner_identity_id, i.email AS owner_email
  FROM tenants t
  LEFT JOIN users u ON u.id = t."ownerId"
  LEFT JOIN identities i ON i.id = u."identityId"
),
ranked AS (
  SELECT c.id AS company_id, c."tenantId" AS tenant_id, o.owner_identity_id, o.owner_email,
         CASE WHEN o.owner_identity_id IS NULL THEN NULL
              ELSE ROW_NUMBER() OVER (PARTITION BY o.owner_identity_id ORDER BY c."createdAt", c.id) END AS owner_rank,
         CASE WHEN o.owner_identity_id IS NULL THEN NULL
              ELSE COUNT(*) OVER (PARTITION BY o.owner_identity_id) END AS owner_company_count
  FROM companies c
  JOIN owners o ON o.tenant_id = c."tenantId"
),
members AS (
  SELECT c.id AS company_id,
         COUNT(DISTINCT u.id) AS active_users,
         COUNT(DISTINCT u.id) FILTER (WHERE pp."canCreate") AS pos_capable_users
  FROM companies c
  JOIN users u ON u."tenantId" = c."tenantId"
              AND (u."companyScope" = 'all' OR u."companyScope" = c.id)
              AND u.active AND u."inviteStatus" = 'accepted' AND u."deletedAt" IS NULL
  LEFT JOIN position_permissions pp ON pp."positionId" = u."positionId" AND pp."moduleId" = 'pos'
  GROUP BY c.id
)
SELECT t.id AS tenant_id, t.code AS tenant_code, t.name AS tenant, c.id AS company_id, c.name AS company,
       c."createdAt" AS company_created_at, c."businessActivity"::text AS business_activity,
       r.owner_identity_id, r.owner_email, r.owner_rank, r.owner_company_count,
       t."subscriptionStatus"::text AS subscription_status, t."subscriptionPlan"::text AS subscription_plan,
       t."trialEndsAt" AS trial_ends_at, t."enabledModules" AS enabled_modules,
       (SELECT COUNT(*) FROM companies c2 WHERE c2."tenantId" = t.id) AS companies_in_tenant,
       COALESCE(m.active_users, 0) AS active_users,
       COALESCE(m.pos_capable_users, 0) AS pos_capable_users,
       (SELECT COUNT(*) FROM warehouses w WHERE w."companyId" = c.id) AS warehouses,
       (SELECT COUNT(*) FROM stock_movements s WHERE s."companyId" = c.id AND s.type IN ('transfer_out', 'transfer_in')) AS stock_transfers,
       (SELECT COUNT(*) FROM stock_movements s WHERE s."companyId" = c.id AND s.type = 'issue') AS stock_issues,
       (SELECT COUNT(*) FROM fixed_assets f WHERE f."companyId" = c.id) AS fixed_assets,
       (SELECT COUNT(*) FROM employees e WHERE e."companyId" = c.id) AS employees
FROM companies c
JOIN tenants t ON t.id = c."tenantId"
JOIN ranked r ON r.company_id = c.id
LEFT JOIN members m ON m.company_id = c.id
ORDER BY r.owner_email NULLS LAST, r.owner_rank NULLS LAST, t.code, c."createdAt";
