-- فصل الهوية (البريد الإلكتروني + كلمة المرور) عن العضوية داخل مستأجر (User) — يسمح بانتماء نفس
-- الشخص (بنفس البريد وكلمة المرور) لعدة مستأجرين منفصلين تماماً، بنفس مبدأ نظام "قيود". هجرة
-- حافظة للبيانات بالكامل: كل مستخدم حالي يحصل على Identity خاصة به (بريده وكلمة مروره الحاليين
-- بلا أي تغيير)، وكل رمز استعادة كلمة مرور غير مستخدم يُعاد ربطه بهوية صاحبه.

-- 1) جدول الهويات الجديد
CREATE TABLE "identities" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "identities_email_key" ON "identities"("email");

-- 2) هوية واحدة لكل مستخدم حالي (email كان فريداً على مستوى users بالفعل، فهذا نسخ حرفي 1:1،
-- بلا أي دمج أو فقدان بيانات) — معرّف عشوائي مستقل تماماً عن معرّف المستخدم القديم عمداً، حتى لا
-- يُخلَط لاحقاً بين النوعين رغم تشابه شكل النص.
INSERT INTO "identities" ("id", "email", "passwordHash", "createdAt", "updatedAt")
SELECT 'id_' || replace(gen_random_uuid()::text, '-', ''), "email", "passwordHash", "createdAt", "updatedAt"
FROM "users";

-- 3) إضافة العمود الجديد على users كـ NULL مبدئياً، تعبئته بالربط عبر البريد القديم، ثم فرضه NOT NULL
ALTER TABLE "users" ADD COLUMN "identityId" TEXT;

UPDATE "users" u
SET "identityId" = i."id"
FROM "identities" i
WHERE i."email" = u."email";

ALTER TABLE "users" ALTER COLUMN "identityId" SET NOT NULL;

-- 4) نفس الشيء لرموز استعادة كلمة المرور (userId -> identityId عبر بريد المستخدم صاحب الرمز)
ALTER TABLE "password_reset_tokens" ADD COLUMN "identityId" TEXT;

UPDATE "password_reset_tokens" prt
SET "identityId" = i."id"
FROM "users" u
JOIN "identities" i ON i."email" = u."email"
WHERE u."id" = prt."userId";

ALTER TABLE "password_reset_tokens" ALTER COLUMN "identityId" SET NOT NULL;

-- 5) إسقاط القيود/الأعمدة القديمة على users وpassword_reset_tokens
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_userId_fkey";
ALTER TABLE "password_reset_tokens" DROP COLUMN "userId";

DROP INDEX "users_email_key";
ALTER TABLE "users" DROP COLUMN "email";
ALTER TABLE "users" DROP COLUMN "passwordHash";

-- 6) قيود/فهارس جديدة + المفاتيح الأجنبية
CREATE UNIQUE INDEX "users_identityId_tenantId_key" ON "users"("identityId", "tenantId");

ALTER TABLE "users" ADD CONSTRAINT "users_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
