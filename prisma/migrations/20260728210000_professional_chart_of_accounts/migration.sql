-- Replace the flat account list with an independent four-level tree for every company plus a
-- consolidated group tree. Existing linked accounts are retained as level-four posting accounts
-- under the migrated-accounts branch so historical journal references remain valid.
DROP INDEX IF EXISTS "accounts_tenantId_name_key";

ALTER TABLE "accounts"
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "code" TEXT,
  ADD COLUMN "level" INTEGER,
  ADD COLUMN "isPosting" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;

WITH scopes AS (
  SELECT t."id" tenant_id, NULL::text company_id, 'group' scope_key FROM "tenants" t
  UNION ALL
  SELECT c."tenantId", c."id", c."id" FROM "companies" c
), types(type_name, root_code, root_name) AS (
  VALUES ('asset', '1', 'الأصول'), ('liability', '2', 'الالتزامات'), ('equity', '3', 'حقوق الملكية'),
         ('revenue', '4', 'الإيرادات'), ('expense', '5', 'المصروفات')
)
INSERT INTO "accounts" ("id", "tenantId", "companyId", "parentId", "code", "level", "isPosting", "isArchived", "name", "type", "isActive", "isBankOrCash", "createdAt", "updatedAt")
SELECT md5(s.tenant_id || s.scope_key || t.type_name || '1'), s.tenant_id, s.company_id, NULL,
       t.root_code, 1, false, false, t.root_name, t.type_name::"AccountType", true, false, NOW(), NOW()
FROM scopes s CROSS JOIN types t;

WITH scopes AS (
  SELECT t."id" tenant_id, NULL::text company_id, 'group' scope_key FROM "tenants" t
  UNION ALL SELECT c."tenantId", c."id", c."id" FROM "companies" c
), types(type_name, root_code, branch_name) AS (
  VALUES ('asset', '1', 'مجموعات الأصول'), ('liability', '2', 'مجموعات الالتزامات'), ('equity', '3', 'مجموعات حقوق الملكية'),
         ('revenue', '4', 'مجموعات الإيرادات'), ('expense', '5', 'مجموعات المصروفات')
)
INSERT INTO "accounts" ("id", "tenantId", "companyId", "parentId", "code", "level", "isPosting", "isArchived", "name", "type", "isActive", "isBankOrCash", "createdAt", "updatedAt")
SELECT md5(s.tenant_id || s.scope_key || t.type_name || '2'), s.tenant_id, s.company_id,
       md5(s.tenant_id || s.scope_key || t.type_name || '1'), t.root_code || '1', 2, false, false,
       t.branch_name, t.type_name::"AccountType", true, false, NOW(), NOW()
FROM scopes s CROSS JOIN types t;

WITH scopes AS (
  SELECT t."id" tenant_id, NULL::text company_id, 'group' scope_key FROM "tenants" t
  UNION ALL SELECT c."tenantId", c."id", c."id" FROM "companies" c
), types(type_name, root_code) AS (
  VALUES ('asset', '1'), ('liability', '2'), ('equity', '3'), ('revenue', '4'), ('expense', '5')
)
INSERT INTO "accounts" ("id", "tenantId", "companyId", "parentId", "code", "level", "isPosting", "isArchived", "name", "type", "isActive", "isBankOrCash", "createdAt", "updatedAt")
SELECT md5(s.tenant_id || s.scope_key || t.type_name || '3'), s.tenant_id, s.company_id,
       md5(s.tenant_id || s.scope_key || t.type_name || '2'), t.root_code || '101', 3, false, false,
       'الحسابات التفصيلية', t.type_name::"AccountType", true, false, NOW(), NOW()
FROM scopes s CROSS JOIN types t;

WITH ranked AS (
  SELECT a."id", a."tenantId", a."type",
         ROW_NUMBER() OVER (PARTITION BY a."tenantId", a."type" ORDER BY a."createdAt", a."id") AS seq
  FROM "accounts" a WHERE a."code" IS NULL
)
UPDATE "accounts" a SET
  "companyId" = NULL,
  "parentId" = md5(a."tenantId" || 'group' || a."type"::text || '3'),
  "code" = CASE a."type" WHEN 'asset' THEN '1101' WHEN 'liability' THEN '2101' WHEN 'equity' THEN '3101' WHEN 'revenue' THEN '4101' ELSE '5101' END
           || LPAD(r.seq::text, 4, '0'),
  "level" = 4,
  "isPosting" = true
FROM ranked r WHERE a."id" = r."id";

ALTER TABLE "accounts" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "accounts" ALTER COLUMN "level" SET NOT NULL;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "accounts_tenantId_companyId_code_key" ON "accounts"("tenantId", "companyId", "code");
CREATE INDEX "accounts_tenantId_companyId_parentId_idx" ON "accounts"("tenantId", "companyId", "parentId");
