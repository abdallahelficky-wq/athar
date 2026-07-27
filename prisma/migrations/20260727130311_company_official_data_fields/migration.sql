/*
  Warnings:

  - You are about to drop the column `nationalAddress` on the `companies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "companies" DROP COLUMN "nationalAddress",
ADD COLUMN     "addressAdditionalNo" TEXT,
ADD COLUMN     "addressBuilding" TEXT,
ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressDistrict" TEXT,
ADD COLUMN     "addressPostalCode" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "crExpiryDate" TIMESTAMP(3),
ADD COLUMN     "crIssueDate" TIMESTAMP(3),
ADD COLUMN     "officialEmail" TEXT,
ADD COLUMN     "phone" TEXT;
