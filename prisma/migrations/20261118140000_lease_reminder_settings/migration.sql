-- إعداد بريد تنبيهات الإيجارات اليومي لكل شركة. جدول جديد فقط.
-- CreateTable
CREATE TABLE "lease_reminder_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hourKsa" INTEGER NOT NULL DEFAULT 8,
    "recipientEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSentAt" TIMESTAMP(3),
    "lastSentPeriodKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lease_reminder_settings_companyId_key" ON "lease_reminder_settings"("companyId");

-- AddForeignKey
ALTER TABLE "lease_reminder_settings" ADD CONSTRAINT "lease_reminder_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_reminder_settings" ADD CONSTRAINT "lease_reminder_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
