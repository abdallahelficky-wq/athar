-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- مفتاح الإنفاذ الشامل (P4): معطّل افتراضياً. لا شركة تُنفَّذ عليها الباقة إلا حين يكون هذا true وصفّها enforced=true.
INSERT INTO "platform_settings" ("key", "value", "updatedAt") VALUES ('subscription_enforcement', 'false'::jsonb, CURRENT_TIMESTAMP);
