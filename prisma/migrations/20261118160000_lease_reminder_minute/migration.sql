-- دقيقة إرسال بريد تنبيهات الإيجارات (مع hourKsa) — عمود جديد بقيمة افتراضية 0، فالإعدادات القائمة تبقى على رأس ساعتها.
-- AlterTable
ALTER TABLE "lease_reminder_settings" ADD COLUMN "minuteKsa" INTEGER NOT NULL DEFAULT 0;
