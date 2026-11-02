-- الوردية المصحَّحة: خانة (المحطة، التاريخ، النوع) تبقى فريدة للورديات القائمة فقط — الورديات المرفوضة والمعكوسة
-- تُستثنى، فتُستعاد خانتها لوردية جديدة (فتح العامل بعد الرفض) أو لوردية مصحَّحة يُدخلها المحاسب (createCorrectedShift).
-- القيد الكامل السابق كان أضيق من الجزئي، فلا يمكن أن تخالفه أي بيانات قائمة. الفهرس الجزئي غير معلَن في schema.prisma
-- (Prisma 5 لا يعبّر عنه) — راجع التعليق فوق @@index([costCenterId, shiftDate, shiftType]) هناك.

-- DropIndex
DROP INDEX "station_shifts_costCenterId_shiftDate_shiftType_key";

-- AlterTable
ALTER TABLE "station_shifts" ADD COLUMN     "correctsShiftId" TEXT;

-- CreateIndex
CREATE INDEX "station_shifts_costCenterId_shiftDate_shiftType_idx" ON "station_shifts"("costCenterId", "shiftDate", "shiftType");

-- CreateIndex
CREATE INDEX "station_shifts_tenantId_correctsShiftId_idx" ON "station_shifts"("tenantId", "correctsShiftId");

-- CreateIndex (partial unique)
CREATE UNIQUE INDEX "station_shifts_active_slot_key" ON "station_shifts"("costCenterId", "shiftDate", "shiftType")
  WHERE "status" NOT IN ('rejected', 'reversed');
