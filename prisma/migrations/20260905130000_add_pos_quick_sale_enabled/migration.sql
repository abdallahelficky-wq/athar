-- تفعيل شاشة البيع السريعة على مستوى الشركة بالكامل (يضبطه صاحب الحساب، لا كل جهاز نقطة بيع على
-- حدة) — عمود جديد بقيمة افتراضية false، فتبقى كل الشركات الحالية على السلوك الحالي بلا أي تغيير.
ALTER TABLE "companies" ADD COLUMN "posQuickSaleEnabled" BOOLEAN NOT NULL DEFAULT false;
