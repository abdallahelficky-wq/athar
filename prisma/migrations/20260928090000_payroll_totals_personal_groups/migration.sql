-- ترحيل الرواتب إجماليات من شهر يحدّده المالك لكل شركة (فارغ = الترحيل القديم، لا تغيير بمجرد النشر).
ALTER TABLE "companies" ADD COLUMN "payrollTotalsFromMonth" TEXT;

-- مجموعات حسابات الأشخاص: تُطوى لرصيد واحد لغير أدوار الموارد البشرية.
ALTER TABLE "accounts" ADD COLUMN "isPersonalGroup" BOOLEAN NOT NULL DEFAULT false;

-- 1) مجموعة «ذمم الموظفين» التي تُنشأ تلقائياً لحسابات الموظفين الفرعية.
UPDATE "accounts" SET "isPersonalGroup" = true
WHERE "isPosting" = false AND name = 'ذمم الموظفين';

-- 2) أب حسابات موظفين بأي اسم آخر — بشرط أن يكون كل أبنائه حسابات موظفين، حتى لا تُطوى مجموعة عامة نُقل
--    إليها حساب موظف واحد (فتختفي حسابات لا علاقة لها بالأشخاص).
UPDATE "accounts" p SET "isPersonalGroup" = true
WHERE p."isPosting" = false
  AND EXISTS (SELECT 1 FROM "accounts" a JOIN "employees" e ON e."accountId" = a.id WHERE a."parentId" = p.id)
  AND NOT EXISTS (
    SELECT 1 FROM "accounts" c
    WHERE c."parentId" = p.id AND NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."accountId" = c.id)
  );

-- 3) مجموعة سلف الموظفين بأسمائهم التي أُنشئت يدوياً (أرمي: scripts/restructure-armi-employee-advances-group.ts).
UPDATE "accounts" SET "isPersonalGroup" = true
WHERE "isPosting" = false AND name = 'سلف وعهد الموظفين';
