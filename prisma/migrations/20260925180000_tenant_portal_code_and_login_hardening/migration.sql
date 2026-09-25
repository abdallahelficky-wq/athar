-- Additive only. Nothing existing is renamed, dropped or repurposed:
--   * tenants.code        — short numeric company code for the employee portal login, next to
--                           tenants.id (still the primary key and the only thing any relation or
--                           JWT references).
--   * employees.portalLockoutCount — how many consecutive lockouts an account has had, so each new
--                           lockout lasts longer than the previous one.
--   * portal_login_throttle — per-IP failed-login counter for POST /employee-portal/login.

-- 1) tenants.code: a Postgres sequence starting at 1000001. nextval() is atomic, so two tenants
--    registered at the same instant can never receive the same code; the unique index is a second
--    guard. A rolled-back registration consumes a number, so codes may have gaps — never duplicates.
CREATE SEQUENCE "tenants_code_seq" AS INTEGER START WITH 1000001 MINVALUE 1000001;

ALTER TABLE "tenants" ADD COLUMN "code" INTEGER;

-- Backfill once, oldest tenant first (ties broken by id), so the oldest tenant is 1000001 and
-- every existing code is fixed from here on — nothing ever renumbers or recomputes them.
UPDATE "tenants" AS t
SET "code" = numbered.n
FROM (
  SELECT "id", 1000000 + ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS n
  FROM "tenants"
) AS numbered
WHERE t."id" = numbered."id";

-- Continue after the highest backfilled code (or start at 1000001 on an empty table).
SELECT setval('"tenants_code_seq"', COALESCE((SELECT MAX("code") FROM "tenants"), 1000001), (SELECT COUNT(*) > 0 FROM "tenants"));

ALTER TABLE "tenants" ALTER COLUMN "code" SET DEFAULT nextval('"tenants_code_seq"');
ALTER TABLE "tenants" ALTER COLUMN "code" SET NOT NULL;
ALTER SEQUENCE "tenants_code_seq" OWNED BY "tenants"."code";

CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- 2) Progressive lockouts.
ALTER TABLE "employees" ADD COLUMN "portalLockoutCount" INTEGER NOT NULL DEFAULT 0;

-- 3) Per-IP failed-login throttle.
CREATE TABLE "portal_login_throttle" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "portal_login_throttle_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "portal_login_throttle_windowStart_idx" ON "portal_login_throttle"("windowStart");
