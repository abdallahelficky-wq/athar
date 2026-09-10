-- تاريخ إقفال السنة المالية على مستوى الشركة — عمود اختياري جديد بلا أي أثر على الصفوف الحالية
-- (كلها تبقى NULL، أي "بلا إقفال"، السلوك الحالي بلا أي تغيير).
ALTER TABLE "companies" ADD COLUMN "fiscalYearClosingDate" TIMESTAMP(3);
