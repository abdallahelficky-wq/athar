-- غير مخزن (Non-Stock) — نوع صنف جديد ومستقل تماماً عن expense: يُشترى (مصروف مباشر) ويُباع (إيراد
-- مباشر) معاً بلا أي قيد تكلفة بضاعة مباعة ولا تتبّع كمية إطلاقاً. راجع تعليق enum ItemType في
-- schema.prisma للتفاصيل الكاملة.
ALTER TYPE "ItemType" ADD VALUE 'non_stock';

-- تصحيح كمية "بضاعة بجرد دوري" عند تسوية الجرد الدوري (فرق العدّ الفعلي مقابل المتتبَّع تشغيلياً) —
-- بلا أي أثر محاسبي بذاتها.
ALTER TYPE "StockMovementType" ADD VALUE 'adjustment';

-- مصدر القيد المحاسبي الناتج عن شاشة تسوية الجرد الدوري (حسابا stockAccountId/purchasesAccountId).
ALTER TYPE "SourceModule" ADD VALUE 'periodic_inventory_settlement';
