-- ميزة قائمة فواتير المبيعات بالبحث/الفلترة/الترقيم من جانب الخادم (searchSalesInvoices) —
-- يُفلتِر الاستعلام دائماً بـ(tenantId, companyId)، ويُرتِّب افتراضياً بـdate تنازلياً. هذا الفهرس
-- يخدم الأمرين معاً (بادئة tenantId+companyId تخدم أي فلتر آخر إضافي أيضاً، وترتيب date كعمود
-- أخير يخدم مسح نطاق مرتَّب دون فرز إضافي عند عدم وجود فلاتر أخرى تُضيِّق النتيجة أولاً).
CREATE INDEX "sales_invoices_tenantId_companyId_date_idx" ON "sales_invoices"("tenantId", "companyId", "date");
