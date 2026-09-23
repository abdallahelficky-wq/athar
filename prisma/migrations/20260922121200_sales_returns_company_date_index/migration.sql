-- ميزة قائمة مردودات المبيعات/إشعارات الدائن بالبحث/الفلترة/الترقيم من جانب الخادم
-- (searchSalesReturns) — يُفلتِر الاستعلام دائماً بـ(tenantId, companyId)، ويُرتِّب افتراضياً بـ
-- date تنازلياً. نفس تبرير الفهرس المطابق على sales_invoices بالضبط.
CREATE INDEX "sales_returns_tenantId_companyId_date_idx" ON "sales_returns"("tenantId", "companyId", "date");
