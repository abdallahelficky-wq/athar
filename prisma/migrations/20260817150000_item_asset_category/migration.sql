-- AlterTable
ALTER TABLE "items" DROP COLUMN "assetCategory",
ADD COLUMN     "assetCategoryId" TEXT;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_assetCategoryId_fkey" FOREIGN KEY ("assetCategoryId") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

