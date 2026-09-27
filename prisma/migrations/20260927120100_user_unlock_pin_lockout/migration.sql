-- قفل فك الترحيل لكل مستخدم بعد 5 محاولات خاطئة متتالية للرقم السري، لمدة 15 دقيقة
ALTER TABLE "users" ADD COLUMN "unlockPinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unlockPinLockedUntil" TIMESTAMP(3);
