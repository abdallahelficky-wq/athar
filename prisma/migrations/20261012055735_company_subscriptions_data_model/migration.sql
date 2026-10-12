-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('yearly', 'monthly');

-- CreateEnum
CREATE TYPE "CompanySubscriptionStatus" AS ENUM ('trialing', 'awaiting_payment', 'active', 'grace', 'expired', 'suspended', 'canceled');

-- CreateEnum
CREATE TYPE "ActivityAddonState" AS ENUM ('off', 'free', 'paid');

-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('created', 'plan_changed', 'period_changed', 'renewed', 'extended', 'grace_started', 'expired', 'suspended', 'activated', 'canceled', 'receipt_applied', 'receipt_unallocated_flagged', 'rank_recomputed', 'pos_users_changed', 'migrated');

-- CreateEnum
CREATE TYPE "PlanPriceItem" AS ENUM ('plan_basic', 'plan_professional', 'plan_enterprise', 'addon_user', 'addon_pos', 'addon_stations', 'addon_stables');

-- AlterTable
ALTER TABLE "identities" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "trialConsumedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "company_subscriptions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerIdentityId" TEXT,
    "plan" "SubscriptionPlan" NOT NULL,
    "billingPeriod" "BillingPeriod" NOT NULL,
    "status" "CompanySubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "legacyOpenEnded" BOOLEAN NOT NULL DEFAULT false,
    "discountRank" INTEGER NOT NULL DEFAULT 1,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "netPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grandfatheredNetPrice" DECIMAL(12,2),
    "scheduledPlan" "SubscriptionPlan",
    "scheduledBillingPeriod" "BillingPeriod",
    "extraUsers" INTEGER NOT NULL DEFAULT 0,
    "posUsers" INTEGER NOT NULL DEFAULT 0,
    "stationsAddon" "ActivityAddonState" NOT NULL DEFAULT 'off',
    "stablesAddon" "ActivityAddonState" NOT NULL DEFAULT 'off',
    "suspensionReason" TEXT,
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "companySubscriptionId" TEXT NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" TEXT NOT NULL,
    "item" "PlanPriceItem" NOT NULL,
    "yearlyNetPrice" DECIMAL(12,2),
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_pos_users" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,

    CONSTRAINT "company_pos_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_subscriptions_companyId_key" ON "company_subscriptions"("companyId");

-- CreateIndex
CREATE INDEX "company_subscriptions_ownerIdentityId_idx" ON "company_subscriptions"("ownerIdentityId");

-- CreateIndex
CREATE INDEX "company_subscriptions_status_currentPeriodEnd_idx" ON "company_subscriptions"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "subscription_events_companySubscriptionId_at_idx" ON "subscription_events"("companySubscriptionId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_item_effectiveFrom_key" ON "plan_prices"("item", "effectiveFrom");

-- CreateIndex
CREATE INDEX "company_pos_users_userId_idx" ON "company_pos_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "company_pos_users_companyId_userId_key" ON "company_pos_users"("companyId", "userId");

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_ownerIdentityId_fkey" FOREIGN KEY ("ownerIdentityId") REFERENCES "identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_companySubscriptionId_fkey" FOREIGN KEY ("companySubscriptionId") REFERENCES "company_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_pos_users" ADD CONSTRAINT "company_pos_users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_pos_users" ADD CONSTRAINT "company_pos_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- القيود والمشغّلات (docs/design/subscription-plans.md §3) — كُتبت يدوياً فوق ما ولّده Prisma، بأسماء الجداول الحقيقية.
-- ---------------------------------------------------------------------------

-- تاريخ نهاية حقيقي: لا "نشط بلا نهاية" إلا لصف مُرحَّل معلَّم، وذاك لا يُفعَّل عليه الإنفاذ أبداً
ALTER TABLE "company_subscriptions"
  ADD CONSTRAINT "company_subscriptions_end_required"
    CHECK ("currentPeriodEnd" IS NOT NULL OR "legacyOpenEnded"),
  ADD CONSTRAINT "company_subscriptions_legacy_not_enforced"
    CHECK (NOT ("legacyOpenEnded" AND "enforced")),
  ADD CONSTRAINT "company_subscriptions_period_order"
    CHECK ("currentPeriodStart" IS NULL OR "currentPeriodEnd" IS NULL OR "currentPeriodEnd" > "currentPeriodStart"),
  ADD CONSTRAINT "company_subscriptions_discount_range"
    CHECK ("discountRank" >= 1 AND "discountPct" >= 0 AND "discountPct" <= 50),
  ADD CONSTRAINT "company_subscriptions_amounts_nonnegative"
    CHECK ("netPrice" >= 0 AND ("grandfatheredNetPrice" IS NULL OR "grandfatheredNetPrice" >= 0)
           AND "extraUsers" >= 0 AND "posUsers" >= 0);

ALTER TABLE "plan_prices"
  ADD CONSTRAINT "plan_prices_nonnegative" CHECK ("yearlyNetPrice" IS NULL OR "yearlyNetPrice" >= 0);

-- سجل أحداث الاشتراك: إضافة فقط (نفس نمط zatca_document_archive)
CREATE FUNCTION subscription_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'subscription_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "subscription_events"
  FOR EACH ROW EXECUTE FUNCTION subscription_events_immutable();

CREATE TRIGGER subscription_events_no_truncate
  BEFORE TRUNCATE ON "subscription_events"
  FOR EACH STATEMENT EXECUTE FUNCTION subscription_events_immutable();

-- الأسعار: الصف الساري (effectiveFrom <= اليوم) لا يُعدَّل ولا يُحذف، ولا يُنقَل صف مستقبلي إلى تاريخ سارٍ بالتعديل —
-- فيبقى السعر الذي طُبِّق في أي يوم ماضٍ مقروءاً. تغيير السعر = صف جديد بتاريخ لاحق.
CREATE FUNCTION plan_prices_in_effect_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'plan_prices: TRUNCATE is not allowed';
  END IF;
  IF OLD."effectiveFrom" <= CURRENT_DATE THEN
    RAISE EXCEPTION 'plan_prices: % of a price already in effect (% from %) is not allowed', TG_OP, OLD."item", OLD."effectiveFrom";
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."effectiveFrom" <= CURRENT_DATE THEN
    RAISE EXCEPTION 'plan_prices: a scheduled price cannot be moved to a date already in effect (%)', NEW."effectiveFrom";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_prices_no_change_in_effect
  BEFORE UPDATE OR DELETE ON "plan_prices"
  FOR EACH ROW EXECUTE FUNCTION plan_prices_in_effect_immutable();

CREATE TRIGGER plan_prices_no_truncate
  BEFORE TRUNCATE ON "plan_prices"
  FOR EACH STATEMENT EXECUTE FUNCTION plan_prices_in_effect_immutable();

-- مستخدم نقطة البيع: العضو والشركة من المستأجر نفسه (CLAUDE.md القاعدة 4)
CREATE FUNCTION company_pos_users_same_tenant() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "users" u JOIN "companies" c ON c."tenantId" = u."tenantId"
    WHERE u.id = NEW."userId" AND c.id = NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'company_pos_users: user % is not a member of the tenant of company %', NEW."userId", NEW."companyId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER company_pos_users_same_tenant
  BEFORE INSERT OR UPDATE ON "company_pos_users"
  FOR EACH ROW EXECUTE FUNCTION company_pos_users_same_tenant();

-- الأسعار المعتمدة من المالك (سنوية، قبل ضريبة 15%). المحطات والإسطبلات: لم يُحدَّد السعر بعد (null = مجانية للقائمة).
INSERT INTO "plan_prices" ("id", "item", "yearlyNetPrice", "effectiveFrom") VALUES
  ('plan_price_seed_basic',        'plan_basic',        500.00,  DATE '2026-10-12'),
  ('plan_price_seed_professional', 'plan_professional', 1000.00, DATE '2026-10-12'),
  ('plan_price_seed_enterprise',   'plan_enterprise',   1500.00, DATE '2026-10-12'),
  ('plan_price_seed_addon_user',   'addon_user',        120.00,  DATE '2026-10-12'),
  ('plan_price_seed_addon_pos',    'addon_pos',         600.00,  DATE '2026-10-12'),
  ('plan_price_seed_addon_station','addon_stations',    NULL,    DATE '2026-10-12'),
  ('plan_price_seed_addon_stables','addon_stables',     NULL,    DATE '2026-10-12');
