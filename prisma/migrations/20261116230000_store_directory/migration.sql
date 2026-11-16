-- دليل المتاجر العام: موافقة الشركة على إدراج متجرها. عمود جديد بقيمة افتراضية false — لا متجر قائم يُدرَج تلقائياً.
ALTER TABLE "companies" ADD COLUMN "storeListed" BOOLEAN NOT NULL DEFAULT false;
