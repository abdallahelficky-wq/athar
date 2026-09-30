-- معاينة ترحيل PR C: ما الحساب الذي سيُربَط بكل دور لكل شركة — للقراءة فقط.
-- نفس ترتيب البدائل الذي يستخدمه getAccountIdByName اليوم، فالنتيجة = الحساب الذي يُرحَّل إليه فعلاً الآن.
-- status: mapped = حساب واحد بالاسم؛ AMBIGUOUS = أكثر من حساب بنفس الاسم الفائز (اليوم يُختار أحدها عشوائياً)؛ UNMAPPED = لا يوجد.
WITH candidates(role, priority, name) AS (VALUES
    ('cash_on_hand',0,'النقدية بالصندوق'),
    ('cash_on_hand',1,'الصندوق النقدي - الإدارة العامة'),
    ('default_bank',0,'البنك الأهلي - حساب تشغيلي'),
    ('default_bank',1,'مصرف الراجحي'),
    ('default_bank',2,'بنك - حساب جاري (1)'),
    ('receivables_control',0,'ذمم مدينة'),
    ('receivables_control',1,'العملاء'),
    ('receivables_control',2,'عملاء - مبيعات جملة/عقود'),
    ('payables_control',0,'ذمم دائنة - موردين'),
    ('payables_control',1,'الموردون'),
    ('payables_control',2,'موردون - محليون'),
    ('employee_payables',0,'ذمم الموظفين - مستحقات وإجازات'),
    ('employee_payables',1,'مستحقات الموظفين'),
    ('employee_payables',2,'رواتب مستحقة'),
    ('salaries_payable',0,'رواتب مستحقة للصرف'),
    ('salaries_payable',1,'رواتب وأجور مستحقة'),
    ('salaries_payable',2,'رواتب مستحقة'),
    ('vat_output',0,'ضريبة القيمة المضافة - مخرجات'),
    ('vat_output',1,'ضريبة القيمة المضافة على المخرجات'),
    ('vat_output',2,'ضريبة القيمة المضافة المستحقة (مبيعات)'),
    ('vat_input',0,'ضريبة القيمة المضافة - مدخلات'),
    ('vat_input',1,'ضريبة القيمة المضافة على المدخلات'),
    ('vat_input',2,'ضريبة القيمة المضافة - مدينة (مشتريات)'),
    ('inventory_adjustment',0,'تسويات المخزون'),
    ('inventory_adjustment',1,'فروقات وهبوط مخزون'),
    ('inventory_adjustment',2,'عجز/فائض جرد المتاجر (Shrinkage)'),
    ('cogs_default',0,'تكلفة البضاعة المباعة / الصرف المخزني'),
    ('cogs_default',1,'تكلفة البضاعة المباعة'),
    ('cogs_default',2,'تكلفة مواد البناء المستهلكة بالمشاريع'),
    ('cogs_default',3,'مواد خام مستهلكة في الإنتاج'),
    ('cogs_default',4,'تكلفة شراء البضاعة'),
    ('cogs_default',5,'تكلفة شراء الوقود (بنزين وديزل)'),
    ('intercompany_current',0,'حساب جاري - شركات المجموعة'),
    ('intercompany_current',1,'أطراف ذات علاقة مدينة'),
    ('intercompany_current',2,'عملاء - أطراف ذات علاقة'),
    ('salary_expense',0,'مصروف رواتب'),
    ('salary_expense',1,'رواتب وأجور إدارية'),
    ('salary_expense',2,'رواتب الموظفين - الإدارة العامة'),
    ('ticket_visa_expense',0,'مصروف تذاكر وتأشيرات الموظفين'),
    ('ticket_visa_expense',1,'سفر وانتقالات'),
    ('fixed_assets',0,'الأصول الثابتة'),
    ('fixed_assets',1,'أصول ثابتة أخرى'),
    ('accumulated_depreciation',0,'مجمع الإهلاك'),
    ('accumulated_depreciation',1,'مجمع إهلاك أصول ثابتة أخرى'),
    ('accumulated_depreciation',2,'مجمع الإهلاك (عكسي)'),
    ('depreciation_expense',0,'مصروف إهلاك الأصول الثابتة'),
    ('depreciation_expense',1,'إهلاك أصول ثابتة أخرى'),
    ('depreciation_expense',2,'إهلاك الممتلكات والمعدات'),
    ('disposal_gain',0,'أرباح استبعاد أصول'),
    ('disposal_gain',1,'أرباح بيع أصول'),
    ('disposal_gain',2,'أرباح/خسائر بيع أصول ثابتة'),
    ('disposal_loss',0,'خسائر استبعاد أصول'),
    ('disposal_loss',1,'خسائر بيع أصول'),
    ('disposal_loss',2,'أرباح/خسائر بيع أصول ثابتة'),
    ('station_petty_cash',0,'صندوق نثرية الفروع/المواقع'),
    ('station_fuel_card_receivable',0,'ذمم شركات بطاقات الوقود/الأسطول'),
    ('station_pos_network_receivable',0,'ذمم شبكة نقاط البيع (مدى)'),
    ('station_other_expense',0,'مصروفات إدارية متنوعة أخرى'),
    ('station_revenue_diesel',0,'إيراد مبيعات ديزل'),
    ('station_revenue_91',0,'إيراد مبيعات بنزين 91'),
    ('station_revenue_95',0,'إيراد مبيعات بنزين 95')
),
hits AS (
  SELECT c.id AS company_id, k.role, k.priority, a.id AS account_id, a.code, a.name
  FROM companies c
  JOIN candidates k ON true
  JOIN accounts a ON a."companyId" = c.id AND a.name = k.name AND a."isPosting" AND a."isActive" AND NOT a."isArchived"
),
best AS (
  SELECT company_id, role, MIN(priority) AS priority FROM hits GROUP BY company_id, role
)
SELECT co.name AS company, co.id AS company_id, r.role,
       CASE WHEN COUNT(h.account_id) = 0 THEN 'UNMAPPED'
            WHEN COUNT(h.account_id) > 1 THEN 'AMBIGUOUS'
            ELSE 'mapped' END AS status,
       STRING_AGG(h.code || ' ' || h.name, ' | ' ORDER BY h.code) AS account
FROM companies co
CROSS JOIN (SELECT DISTINCT role FROM candidates) r
LEFT JOIN best b ON b.company_id = co.id AND b.role = r.role
LEFT JOIN hits h ON h.company_id = co.id AND h.role = r.role AND h.priority = b.priority
GROUP BY co.id, co.name, r.role
ORDER BY co.name, co.id, status DESC, r.role;
