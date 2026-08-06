-- حسابات تفصيلية مستقلة تلقائية لكل عميل/مورد/موظف — هجرة إضافية بحتة (لا تغيّر أي سلوك حالي):
-- الأعمدة الثلاثة nullable مبدئياً حتى تُنشأ الحسابات وتُملأ عبر scripts/backfillPartyAccounts.ts
-- (تقرير أولاً، ثم --commit بعد التأكيد)، ثم تُفرَض NOT NULL في هجرة لاحقة منفصلة.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "accountId" TEXT;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
