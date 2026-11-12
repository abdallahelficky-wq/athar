-- وردية محطة آلية: قراءات العدادات تُؤخذ من متحكم PTS-2 (العداد التراكمي في آخر عملية بيع) لا من صور العامل
CREATE TYPE "StationShiftReadingsSource" AS ENUM ('photo', 'controller');
ALTER TABLE "station_shifts" ADD COLUMN "readingsSource" "StationShiftReadingsSource" NOT NULL DEFAULT 'photo';
