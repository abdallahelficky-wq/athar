-- متى ومن أضاف كل تخصيص سند قبض. التخصيصات الموجودة تبقى بلا تاريخ ولا مستخدم (NULL) لأن وقتها غير
-- معروف فعلاً — العمود يُضاف أولاً بلا قيمة افتراضية حتى لا تُختَم الصفوف القديمة بوقت تشغيل هذه
-- الترقية، ثم تُضبط القيمة الافتراضية للصفوف الجديدة فقط.
ALTER TABLE "receipt_allocations" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "receipt_allocations" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "receipt_allocations" ADD COLUMN "createdByUserId" TEXT;
