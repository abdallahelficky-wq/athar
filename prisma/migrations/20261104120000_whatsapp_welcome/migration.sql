-- جوال صاحب الاشتراك وموافقته على رسائل واتساب، وسجل رسائل واتساب الآلية (رسالة الترحيب).
ALTER TABLE "tenants" ADD COLUMN "ownerMobile" TEXT;
ALTER TABLE "tenants" ADD COLUMN "whatsappOptInAt" TIMESTAMP(3);

CREATE TABLE "whatsapp_message_logs" (
 "id" TEXT NOT NULL,
 "tenantId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "phone" TEXT NOT NULL,
 "template" TEXT NOT NULL,
 "status" TEXT NOT NULL,
 "providerMessageId" TEXT,
 "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "whatsapp_message_logs_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "whatsapp_message_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "whatsapp_message_logs_providerMessageId_key" ON "whatsapp_message_logs"("providerMessageId");
CREATE UNIQUE INDEX "whatsapp_message_logs_tenantId_kind_key" ON "whatsapp_message_logs"("tenantId", "kind");
