-- CreateEnum
CREATE TYPE "SubscriptionReminderKind" AS ENUM ('before_14', 'before_7', 'before_1', 'grace_started', 'read_only');

-- CreateTable
CREATE TABLE "subscription_reminders" (
    "id" TEXT NOT NULL,
    "companySubscriptionId" TEXT NOT NULL,
    "kind" "SubscriptionReminderKind" NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_reminders_companySubscriptionId_kind_periodEnd_key" ON "subscription_reminders"("companySubscriptionId", "kind", "periodEnd");

-- AddForeignKey
ALTER TABLE "subscription_reminders" ADD CONSTRAINT "subscription_reminders_companySubscriptionId_fkey" FOREIGN KEY ("companySubscriptionId") REFERENCES "company_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
