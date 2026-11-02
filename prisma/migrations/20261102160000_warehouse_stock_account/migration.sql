-- حساب مخزون لكل مستودع: إضافي (عمود فارغ). المستودعات القائمة تبقى بلا حساب فيبقى ترحيلها على حساب الصنف كما كان.
-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "stockAccountId" TEXT;

-- CreateIndex
CREATE INDEX "warehouses_stockAccountId_idx" ON "warehouses"("stockAccountId");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_stockAccountId_fkey" FOREIGN KEY ("stockAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
