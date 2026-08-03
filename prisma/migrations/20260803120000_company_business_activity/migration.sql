-- نشاط المنشأة — يحدد قالب شجرة الحسابات الذي يُزرَع تلقائياً عند إنشاء شركة جديدة
CREATE TYPE "BusinessActivity" AS ENUM ('contracting', 'manufacturing', 'retail', 'general_trade', 'fuel_stations');

ALTER TABLE "companies" ADD COLUMN "businessActivity" "BusinessActivity";
