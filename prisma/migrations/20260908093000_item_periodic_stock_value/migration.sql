-- قيمة المخزون الحالية المُعتمَدة لصنف "بضاعة بجرد دوري" — محفوظة بمعزل عن رصيد GL الفعلي
-- (stockAccountId) لأنه قد يكون حساباً مشتركاً بين عدة أصناف. راجع تعليق الحقل في schema.prisma.
ALTER TABLE "items" ADD COLUMN "periodicStockValue" DECIMAL(18,2) NOT NULL DEFAULT 0;
