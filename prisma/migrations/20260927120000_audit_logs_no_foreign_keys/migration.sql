-- سجلّا التدقيق (audit_logs و station_shift_audit_logs) لا يرتبطان بعد اليوم بأي جدول آخر بمفتاح أجنبي،
-- فلا يمحوهما أي حذف: كان حذف المستأجر أو الشركة أو الوردية يحذف صفوفهما (CASCADE)، وحذف المستخدم
-- يمسح منفّذ كل صف (SET NULL). الأعمدة نفسها (tenantId/companyId/shiftId/userId) تبقى كقيم نصية عادية.

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_tenantId_fkey";
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_userId_fkey";
ALTER TABLE "station_shift_audit_logs" DROP CONSTRAINT "station_shift_audit_logs_companyId_fkey";
ALTER TABLE "station_shift_audit_logs" DROP CONSTRAINT "station_shift_audit_logs_shiftId_fkey";
ALTER TABLE "station_shift_audit_logs" DROP CONSTRAINT "station_shift_audit_logs_tenantId_fkey";
ALTER TABLE "station_shift_audit_logs" DROP CONSTRAINT "station_shift_audit_logs_userId_fkey";

-- AlterTable: الشركة (اختيارية في السجل العام) ونسختا اسم المنفّذ وبريده لحظة الحدث
ALTER TABLE "audit_logs" ADD COLUMN "actorEmail" TEXT,
ADD COLUMN "actorName" TEXT,
ADD COLUMN "companyId" TEXT;
ALTER TABLE "station_shift_audit_logs" ADD COLUMN "actorEmail" TEXT,
ADD COLUMN "actorName" TEXT;

-- CreateIndex (فحص "هل ظهر هذا المستخدم في أي صف تدقيق" قبل أي حذف لمستخدم)
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX "station_shift_audit_logs_userId_idx" ON "station_shift_audit_logs"("userId");

-- تعبئة نسختَي المنفّذ للصفوف القائمة من المستخدم الحالي (ما زال موجوداً لكل صف له userId اليوم —
-- SET NULL كان يمسح المعرّف نفسه عند حذف المستخدم، فلا صفوف يتيمة بمعرّف لمستخدم غير موجود)
UPDATE "audit_logs" a SET "actorName" = u."name", "actorEmail" = i."email"
FROM "users" u JOIN "identities" i ON i."id" = u."identityId"
WHERE a."userId" = u."id";
UPDATE "station_shift_audit_logs" a SET "actorName" = u."name", "actorEmail" = i."email"
FROM "users" u JOIN "identities" i ON i."id" = u."identityId"
WHERE a."userId" = u."id";

-- كل إدراج جديد يحمل نسختَي المنفّذ تلقائياً — في قاعدة البيانات لا في كل مسار كتابة، فلا يُنسى أيٌّ
-- منها مستقبلاً. قيمة مُمرَّرة صراحةً من التطبيق (غير NULL) لا تُستبدَل.
CREATE OR REPLACE FUNCTION audit_fill_actor() RETURNS trigger AS $$
DECLARE
  v_name TEXT;
  v_email TEXT;
BEGIN
  IF NEW."userId" IS NOT NULL AND (NEW."actorName" IS NULL OR NEW."actorEmail" IS NULL) THEN
    SELECT u."name", i."email" INTO v_name, v_email
      FROM "users" u JOIN "identities" i ON i."id" = u."identityId"
      WHERE u."id" = NEW."userId";
    NEW."actorName" := COALESCE(NEW."actorName", v_name);
    NEW."actorEmail" := COALESCE(NEW."actorEmail", v_email);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_fill_actor BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_fill_actor();
CREATE TRIGGER station_shift_audit_logs_fill_actor BEFORE INSERT ON "station_shift_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_fill_actor();
