-- اتجاه عقد الإيجار (مستأجر/مؤجر للغير) ونوع العين المؤجرة
CREATE TYPE "LeaseDirection" AS ENUM ('lessee', 'lessor');
CREATE TYPE "LeaseCategory" AS ENUM ('fuel_station', 'car_wash', 'shop_restaurant', 'office', 'staff_housing', 'warehouse', 'land', 'other');

ALTER TABLE "lease_contracts" ADD COLUMN "direction" "LeaseDirection" NOT NULL DEFAULT 'lessee';
ALTER TABLE "lease_contracts" ADD COLUMN "category" "LeaseCategory";
