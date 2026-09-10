-- بضاعة بجرد دوري (Periodic Inventory) — نوع صنف جديد، وحساب "المشتريات" المستقل الخاص به (لا
-- يُخلَط بـcogsAccountId). النوع نفسه محجوب من الاستخدام الفعلي حتى اكتمال شاشة تسوية الجرد الدوري
-- (راجع PERIODIC_INVENTORY_ENABLED في items.schemas.ts) — هذه الهجرة بنيوية بحتة، لا تُفعِّل شيئاً.
ALTER TYPE "ItemType" ADD VALUE 'periodic_inventory';

ALTER TABLE "items" ADD COLUMN "purchasesAccountId" TEXT;
ALTER TABLE "items" ADD CONSTRAINT "items_purchasesAccountId_fkey" FOREIGN KEY ("purchasesAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
