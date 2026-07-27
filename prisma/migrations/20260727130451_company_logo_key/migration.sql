/*
  Warnings:

  - You are about to drop the column `logoUrl` on the `companies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "companies" DROP COLUMN "logoUrl",
ADD COLUMN     "logoKey" TEXT;
